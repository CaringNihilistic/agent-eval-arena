"""Claude models through the Claude Agent SDK, on the owner's subscription login.

The loop here is Claude Code's, not ours: the SDK starts the Claude Code binary,
which talks to the model and calls our tools. This backend watches the session's
event stream and reports what happens to the shared RunContext, so the trace,
the limits, and the tools are the same as for the LiteLLM backend.

Local only. See docs/CLAUDE_BACKEND.md.
"""

import asyncio
import json
import os
import shutil
import tempfile
import time
from collections import deque
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import Any, Protocol, cast

from arena.backends.claude_auth import (
    MCP_SERVER,
    SubscriptionAuthError,
    UsageLimitReachedError,
    check_environment,
    check_rate_limit,
    check_session,
    mcp_name,
    plain_name,
)
from arena.llm import LLMResponse, ToolCallRequest, parse_arguments
from arena.run_context import RunContext
from arena.tools.registry import (
    SUBMIT_ANSWER,
    SUBMIT_ANSWER_DESCRIPTION,
    SUBMIT_ANSWER_PARAMETERS,
)

# How long a tool call waits for the model response it belongs to. Claude Code can
# start a tool before the response has finished streaming.
RESPONSE_WAIT_S = 20.0
# Wall-clock allowance on top of the run's active-time limit before a silent
# session is given up on.
SESSION_GRACE_S = 120.0

# Settings for the Claude Code process. Nothing from the user's own Claude Code
# setup is loaded, and features that add tools or context of their own are off.
HARNESS_ENV = {
    # Tool search would hide our tool schemas behind an extra ToolSearch call.
    "ENABLE_TOOL_SEARCH": "false",
    "CLAUDE_CODE_DISABLE_ATTACHMENTS": "1",
    "CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_AUTOUPDATER": "1",
    # Claude Code turns extended thinking on by itself. The other backends set no
    # reasoning options, so thinking is turned off where the model allows it and
    # set to the lowest effort where it does not (Opus 5.5 and Sonnet 5.5 cannot
    # have thinking turned off).
    "MAX_THINKING_TOKENS": "0",
    "CLAUDE_CODE_EFFORT_LEVEL": "low",
}
# Claude Code's own default is 32,000 output tokens per call. This variable carries
# the same per-call cap the LiteLLM backend passes as max_tokens.
MAX_OUTPUT_VARIABLE = "CLAUDE_CODE_MAX_OUTPUT_TOKENS"

Hook = Callable[[dict[str, Any], str | None, Any], Any]
ToolHandler = Callable[[dict[str, Any]], Any]


class SdkClient(Protocol):
    """The part of ClaudeSDKClient this backend uses. Tests supply a scripted one."""

    async def __aenter__(self) -> "SdkClient": ...

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> Any: ...  # noqa: ANN401

    async def query(self, prompt: str) -> None: ...

    def receive_response(self) -> AsyncIterator[Any]: ...

    async def interrupt(self) -> None: ...


class SessionSpec(Protocol):
    """What the backend asks the SDK for. Kept abstract so tests can inspect it."""

    system_prompt: str
    model: str
    max_turns: int
    tools: dict[str, tuple[str, dict[str, Any], ToolHandler]]
    pre_tool_use: Hook
    post_tool_use: Hook
    env: dict[str, str]
    cwd: Path


class _Spec:
    def __init__(
        self,
        *,
        system_prompt: str,
        model: str,
        max_turns: int,
        tools: dict[str, tuple[str, dict[str, Any], ToolHandler]],
        pre_tool_use: Hook,
        post_tool_use: Hook,
        env: dict[str, str],
        cwd: Path,
    ) -> None:
        self.system_prompt = system_prompt
        self.model = model
        self.max_turns = max_turns
        self.tools = tools
        self.pre_tool_use = pre_tool_use
        self.post_tool_use = post_tool_use
        self.env = env
        self.cwd = cwd


ClientFactory = Callable[[SessionSpec], SdkClient]


def real_client(spec: SessionSpec) -> SdkClient:
    """Build a ClaudeSDKClient with only our prompt and our tools."""
    from claude_agent_sdk import (
        ClaudeAgentOptions,
        ClaudeSDKClient,
        HookMatcher,
        create_sdk_mcp_server,
        tool,
    )

    sdk_tools = [
        tool(name, description, parameters)(handler)
        for name, (description, parameters, handler) in spec.tools.items()
    ]
    options = ClaudeAgentOptions(
        system_prompt=spec.system_prompt,
        # No built-in tools at all: the model can only call ours.
        tools=[],
        mcp_servers={MCP_SERVER: create_sdk_mcp_server(MCP_SERVER, "1.0.0", sdk_tools)},
        allowed_tools=[mcp_name(name) for name in spec.tools],
        # No CLAUDE.md, user settings, skills, hooks, or apiKeyHelper from disk.
        setting_sources=[],
        model=spec.model,
        max_turns=spec.max_turns,
        # The only way to get real per-call output tokens and timing.
        include_partial_messages=True,
        hooks={
            # The SDK types hook input as per-event TypedDicts; ours take the common shape.
            "PreToolUse": [HookMatcher(hooks=[cast(Any, spec.pre_tool_use)])],
            "PostToolUse": [HookMatcher(hooks=[cast(Any, spec.post_tool_use)])],
        },
        env=spec.env,
        cwd=spec.cwd,
        # Claude Code's own log output is dropped: it must never reach a trace.
        stderr=lambda _line: None,
    )
    return cast(SdkClient, ClaudeSDKClient(options=options))


class _Response:
    """One model response, rebuilt from the raw stream events."""

    def __init__(self, usage: Mapping[str, Any], requested_at: float) -> None:
        self.requested_at = requested_at
        self.input_tokens = int(usage.get("input_tokens") or 0)
        self.cache_read_tokens = int(usage.get("cache_read_input_tokens") or 0)
        self.cache_write_tokens = int(usage.get("cache_creation_input_tokens") or 0)
        self.output_tokens = int(usage.get("output_tokens") or 0)
        self.text: list[str] = []
        # None until a thinking block starts; the text may still be empty.
        self.thinking: list[str] | None = None
        self.tool_uses: dict[int, dict[str, Any]] = {}

    def start_block(self, index: int, block: Mapping[str, Any]) -> None:
        if block.get("type") == "tool_use":
            self.tool_uses[index] = {"id": block["id"], "name": block["name"], "json": ""}
        elif block.get("type") == "thinking":
            self.thinking = self.thinking if self.thinking is not None else []
            if block.get("thinking"):
                self.thinking.append(str(block["thinking"]))

    def add_delta(self, index: int, delta: Mapping[str, Any]) -> None:
        if delta.get("type") == "text_delta":
            self.text.append(str(delta.get("text", "")))
        elif delta.get("type") == "thinking_delta":
            self.thinking = self.thinking if self.thinking is not None else []
            self.thinking.append(str(delta.get("thinking", "")))
        elif delta.get("type") == "input_json_delta" and index in self.tool_uses:
            self.tool_uses[index]["json"] += str(delta.get("partial_json", ""))

    def calls(self) -> list[ToolCallRequest]:
        return [
            ToolCallRequest(
                call_id=use["id"],
                name=plain_name(use["name"]),
                arguments=parse_arguments(use["json"]),
                raw_arguments=use["json"],
            )
            for _index, use in sorted(self.tool_uses.items())
        ]

    def to_llm_response(self, latency_ms: int) -> LLMResponse:
        text = "".join(self.text)
        calls = self.calls()
        message: dict[str, Any] = {"role": "assistant", "content": text or None}
        if calls:
            message["tool_calls"] = [
                {
                    "id": call.call_id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": call.raw_arguments},
                }
                for call in calls
            ]
        return LLMResponse(
            message=message,
            content=text or None,
            tool_calls=calls,
            # All input, cached or not, so the number means the same on every backend.
            prompt_tokens=self.input_tokens + self.cache_read_tokens + self.cache_write_tokens,
            completion_tokens=self.output_tokens,
            latency_ms=latency_ms,
            cache_read_tokens=self.cache_read_tokens,
            cache_write_tokens=self.cache_write_tokens,
            thinking=None if self.thinking is None else "".join(self.thinking),
        )


class _Session:
    """Turns one Claude Code session into RunContext calls."""

    def __init__(self, ctx: RunContext) -> None:
        self.ctx = ctx
        self.current: _Response | None = None
        self.requested_at = time.monotonic()
        # Tool-use ids whose model response has been recorded in the trace.
        self.recorded: set[str] = set()
        self.recorded_changed = asyncio.Condition()
        # Ids handed from the PreToolUse hook to the tool handler, per tool.
        self.queued: dict[str, deque[str]] = {}
        self.unfinished_calls = 0
        self.failure: Exception | None = None
        self.sdk_cost_estimate_usd: float | None = None
        self.harness_version: str | None = None
        # Models the account may use, as the session reports them.
        self.account_models: list[str] = []

    # ------------------------------------------------------------ stream events

    def on_message_start(self, event: Mapping[str, Any]) -> None:
        self.ctx.start_step()
        usage = event.get("message", {}).get("usage") or {}
        self.current = _Response(usage, self.requested_at)

    def on_message_delta(self, event: Mapping[str, Any]) -> None:
        if self.current is not None:
            output = (event.get("usage") or {}).get("output_tokens")
            if output is not None:
                self.current.output_tokens = int(output)

    async def on_message_stop(self) -> bool:
        """Record the finished response. Returns True if the session must be interrupted."""
        response, self.current = self.current, None
        if response is None:
            return False
        ctx = self.ctx
        latency_ms = int((time.monotonic() - response.requested_at) * 1000)
        llm_response = response.to_llm_response(latency_ms)
        ctx.record_llm_call(llm_response)
        ctx.messages.append(llm_response.message)
        calls = llm_response.tool_calls
        self.unfinished_calls = len(calls)

        interrupt = False
        if not calls:
            answer = (llm_response.content or "").strip()
            ctx.finish_step()
            if answer:
                ctx.final_answer = answer
                ctx.stop("answered")
            else:
                ctx.error("the model returned neither an answer nor a tool call", recoverable=False)
                ctx.stop("error")
        else:
            # An answer already given outranks a budget that this same call used up.
            submits = any(call.name == SUBMIT_ANSWER for call in calls)
            reason = ctx.limit_reached()
            if reason is not None and not submits:
                ctx.finish_step()
                ctx.stop(reason)
                interrupt = True

        async with self.recorded_changed:
            self.recorded.update(call.call_id for call in calls)
            self.recorded_changed.notify_all()
        return interrupt

    # ---------------------------------------------------------- hooks and tools

    async def pre_tool_use(
        self, input_data: dict[str, Any], tool_use_id: str | None, _context: object
    ) -> dict[str, Any]:
        """Runs before each tool. Holds the tool until its model response is in the
        trace, so events stay in order, and refuses it if the run has ended."""
        if tool_use_id is not None:
            try:
                async with asyncio.timeout(RESPONSE_WAIT_S), self.recorded_changed:
                    await self.recorded_changed.wait_for(lambda: tool_use_id in self.recorded)
            except TimeoutError:
                self.failure = RuntimeError(
                    "a tool call arrived without the model response it belongs to"
                )
        if self.ctx.stopped or self.failure is not None:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "The run has ended.",
                }
            }
        name = plain_name(str(input_data.get("tool_name", "")))
        if tool_use_id is not None:
            self.queued.setdefault(name, deque()).append(tool_use_id)
        return {}

    async def post_tool_use(
        self, _input_data: dict[str, Any], _tool_use_id: str | None, _context: object
    ) -> dict[str, Any]:
        """Runs after each tool. Ends the session without another model call once
        the run has stopped: answered, out of steps, or over a limit."""
        if self.ctx.stopped:
            return {"continue_": False, "stopReason": "The run has ended."}
        return {}

    def handler(self, name: str) -> ToolHandler:
        async def handle(arguments: dict[str, Any]) -> dict[str, Any]:
            ctx = self.ctx
            if ctx.stopped:
                return {
                    "content": [{"type": "text", "text": "The run has ended."}],
                    "is_error": True,
                }
            queue = self.queued.get(name)
            call_id = queue.popleft() if queue else f"untracked_{ctx.tool_calls + 1}"
            call = ToolCallRequest(call_id, name, arguments, json.dumps(arguments))
            text, success = await ctx.execute_tool_detailed(call)
            ctx.messages.append({"role": "tool", "tool_call_id": call_id, "content": text})

            self.unfinished_calls -= 1
            if self.unfinished_calls <= 0:
                self._finish_step()
            return {"content": [{"type": "text", "text": text}], "is_error": not success}

        return handle

    def _finish_step(self) -> None:
        """Close the step once its last tool has run, and decide whether the run ends."""
        ctx = self.ctx
        ctx.finish_step()
        if ctx.final_answer is not None:
            ctx.stop("answered")
        elif (reason := ctx.limit_reached()) is not None:
            ctx.stop(reason)
        elif ctx.steps >= ctx.config.max_steps:
            ctx.stop("max_steps")
        # The next model request goes out as soon as this tool result is returned.
        self.requested_at = time.monotonic()


def _model_names(models: object) -> list[str]:
    """Model ids from the session's start message, whatever shape it lists them in."""
    names = []
    for model in models if isinstance(models, list) else []:
        if isinstance(model, str):
            names.append(model)
        elif isinstance(model, dict):
            name = model.get("value") or model.get("id") or model.get("model")
            if name:
                names.append(str(name))
    return names


class AgentSdkBackend:
    def __init__(
        self,
        client_factory: ClientFactory = real_client,
        env: Mapping[str, str] | None = None,
        raw_request_dir: Path | None = None,
    ) -> None:
        self._client_factory = client_factory
        self._env = os.environ if env is None else env
        self._raw_request_dir = raw_request_dir
        # Checked here as well as in run(): a refusal should come before the run starts.
        check_environment(self._env)

    def _harness_env(self, config_dir: Path, max_completion_tokens: int) -> dict[str, str]:
        env = dict(HARNESS_ENV)
        env[MAX_OUTPUT_VARIABLE] = str(max_completion_tokens)
        # A throwaway config folder: the session reads and leaves nothing behind.
        env["CLAUDE_CONFIG_DIR"] = str(config_dir)
        if self._raw_request_dir is not None:
            self._raw_request_dir.mkdir(parents=True, exist_ok=True)
            env["CLAUDE_CODE_ENABLE_TELEMETRY"] = "1"
            env["OTEL_LOG_RAW_API_BODIES"] = f"file:{self._raw_request_dir}"
        return env

    async def run(self, ctx: RunContext) -> None:
        check_environment(self._env)
        session = _Session(ctx)
        tools: dict[str, tuple[str, dict[str, Any], ToolHandler]] = {
            name: (tool.description, tool.parameters, session.handler(name))
            for name, tool in ctx.tools.items()
        }
        tools[SUBMIT_ANSWER] = (
            SUBMIT_ANSWER_DESCRIPTION,
            SUBMIT_ANSWER_PARAMETERS,
            session.handler(SUBMIT_ANSWER),
        )

        workdir = Path(tempfile.mkdtemp(prefix="arena-claude-"))
        spec = _Spec(
            system_prompt=ctx.config.system_prompt,
            model=ctx.config.model,
            # A backstop only. Our own step counter ends the run first.
            max_turns=ctx.config.max_steps + 2,
            tools=tools,
            pre_tool_use=session.pre_tool_use,
            post_tool_use=session.post_tool_use,
            env=self._harness_env(workdir / "config", ctx.limits.max_completion_tokens),
            cwd=workdir,
        )
        try:
            async with asyncio.timeout(ctx.limits.timeout_s + SESSION_GRACE_S):
                await self._drive(ctx, session, spec, list(tools))
        except TimeoutError:
            ctx.error("the Claude session did not finish in time", recoverable=False)
            ctx.stop("timeout")
        except UsageLimitReachedError as error:
            ctx.abandoned = True
            ctx.usage_limit_resets_at = error.resets_at
            ctx.error(str(error), recoverable=True)
            ctx.stop("error")
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
        ctx.backend_info["sdk_cost_estimate_usd"] = session.sdk_cost_estimate_usd
        ctx.backend_info["harness_version"] = session.harness_version
        ctx.backend_info["account_models"] = session.account_models

    async def _drive(
        self, ctx: RunContext, session: _Session, spec: SessionSpec, tool_names: list[str]
    ) -> None:
        from claude_agent_sdk.types import (
            AssistantMessage,
            RateLimitEvent,
            ResultMessage,
            StreamEvent,
            SystemMessage,
        )

        async with self._client_factory(spec) as client:
            session.requested_at = time.monotonic()
            await client.query(ctx.task.prompt)
            async for message in client.receive_response():
                if isinstance(message, SystemMessage):
                    if message.subtype == "init":
                        # Raises before the first model call if this is not the
                        # subscription login or the tools are not exactly ours.
                        check_session(message.data, tool_names)
                        version = message.data.get("claude_code_version")
                        session.harness_version = str(version) if version else None
                        session.account_models = _model_names(message.data.get("models"))
                elif isinstance(message, RateLimitEvent):
                    check_rate_limit(message.rate_limit_info)
                elif isinstance(message, StreamEvent):
                    if await self._on_stream_event(session, message.event):
                        await client.interrupt()
                elif isinstance(message, AssistantMessage):
                    if message.error is not None:
                        self._on_assistant_error(ctx, str(message.error))
                elif isinstance(message, ResultMessage):
                    self._on_result(ctx, session, message)
                if session.failure is not None:
                    raise session.failure

    async def _on_stream_event(self, session: _Session, event: Mapping[str, Any]) -> bool:
        kind = event.get("type")
        if kind == "message_start":
            session.on_message_start(event)
        elif kind == "content_block_start" and session.current is not None:
            session.current.start_block(
                int(event.get("index", 0)), event.get("content_block") or {}
            )
        elif kind == "content_block_delta" and session.current is not None:
            session.current.add_delta(int(event.get("index", 0)), event.get("delta") or {})
        elif kind == "message_delta":
            session.on_message_delta(event)
        elif kind == "message_stop":
            return await session.on_message_stop()
        return False

    def _on_assistant_error(self, ctx: RunContext, error: str) -> None:
        if ctx.stopped:
            return
        if error in ("rate_limit", "overloaded", "server_error"):
            ctx.abandoned = True
            ctx.error(f"Claude could not serve the call: {error}", recoverable=True)
        elif error in ("authentication_failed", "billing_error"):
            raise SubscriptionAuthError(
                f"Claude Code reported {error}. The subscription login is not usable."
            )
        else:
            ctx.error(f"the model call failed: {error}", recoverable=False)
        ctx.stop("error")

    def _on_result(self, ctx: RunContext, session: _Session, message: Any) -> None:  # noqa: ANN401
        session.sdk_cost_estimate_usd = message.total_cost_usd
        if ctx.stopped:
            return
        if message.subtype == "error_max_turns":
            ctx.stop("max_steps")
        elif message.is_error:
            if message.api_error_status in (429, 500, 503, 529):
                ctx.abandoned = True
            detail = "; ".join(message.errors or []) or message.subtype
            ctx.error(f"the Claude session failed: {detail}", recoverable=ctx.abandoned)
            ctx.stop("error")
        else:
            ctx.error("the session ended without an answer", recoverable=False)
            ctx.stop("error")
