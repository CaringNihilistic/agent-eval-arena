"""State and bookkeeping for one run, shared by every agent backend.

A backend drives the model; everything it must report or enforce goes through
this object. That keeps limits, tool execution, cost, and trace events identical
no matter which loop is running.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Literal

from arena.config import AgentConfig, Task
from arena.events import Emitter
from arena.llm import LLMResponse, Message, ToolCallRequest
from arena.pricing import ModelEntry, actual_cost_usd, reference_cost_usd
from arena.tools.base import Tool, ToolResult, truncate
from arena.tools.registry import ALL_TOOL_NAMES, SUBMIT_ANSWER

StopReason = Literal["answered", "max_steps", "max_tokens", "max_cost", "timeout", "error"]

TOOL_TIMEOUT_S = 30.0


@dataclass(frozen=True)
class RunLimits:
    """The same values apply to every config, so no config gets more room than another."""

    max_total_tokens: int = 16_000
    max_cost_usd: float = 0.50
    # Active time: model and tool latency. Waiting for a rate limit does not count.
    timeout_s: float = 120.0
    # Free tiers cap tokens per minute, so what a tool returns to the model is kept small.
    tool_output_chars: int = 2_000
    max_completion_tokens: int = 1_024
    preview_chars: int = 600


class RunContext:
    def __init__(
        self,
        *,
        config: AgentConfig,
        task: Task,
        limits: RunLimits,
        emitter: Emitter,
        pricing: ModelEntry,
        tools: dict[str, Tool],
    ) -> None:
        self.config = config
        self.task = task
        self.limits = limits
        self.emitter = emitter
        self.pricing = pricing
        self.tools = tools

        # The conversation, append-only. Provider messages are kept verbatim.
        self.messages: list[Message] = []
        self.steps = 0
        self.tool_calls = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.cost_usd = 0.0
        self.reference_cost_usd = 0.0
        self.active_ms = 0
        self.final_answer: str | None = None
        self.stop_reason: StopReason | None = None
        # True when a rate limit cut the run short. Such a run is re-run, not scored.
        self.abandoned = False
        # Model responses in a row that the provider rejected as unusable tool calls.
        self.consecutive_rejections = 0
        # When the subscription's usage limit resets, if that is what stopped the run.
        self.usage_limit_resets_at: int | None = None
        # Facts about the backend that are not part of the trace.
        self.backend_info: dict[str, Any] = {}
        self._previewed_upto = 0
        self._trace_call_ids: dict[str, str] = {}

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    @property
    def remaining_time_s(self) -> float:
        return max(self.limits.timeout_s - self.active_ms / 1000, 0.0)

    @property
    def stopped(self) -> bool:
        return self.stop_reason is not None

    def limit_reached(self) -> StopReason | None:
        """The budget limit that has been hit, if any. Step count is checked separately."""
        if self.total_tokens >= self.limits.max_total_tokens:
            return "max_tokens"
        if self.cost_usd >= self.limits.max_cost_usd:
            return "max_cost"
        if self.remaining_time_s <= 0:
            return "timeout"
        return None

    def stop(self, reason: StopReason) -> None:
        if self.stop_reason is None:
            self.stop_reason = reason

    def error(self, message: str, *, recoverable: bool) -> None:
        self.emitter.emit(
            "error",
            {"message": message, "recoverable": recoverable, "step": self.steps or None},
        )

    def start_step(self) -> int:
        self.steps += 1
        self.emitter.emit("step_started", {"step": self.steps})
        return self.steps

    def finish_step(self) -> None:
        self.emitter.emit(
            "step_finished",
            {
                "step": self.steps,
                "total_tokens": self.total_tokens,
                "cost_usd": self.cost_usd,
                "reference_cost_usd": self.reference_cost_usd,
            },
        )

    def add_active_time(self, latency_ms: int) -> None:
        self.active_ms += latency_ms

    def trace_call_id(self, provider_call_id: str) -> str:
        """The id a tool call carries in the trace.

        Provider ids stay in the conversation, where the provider needs them. They do
        not go into the trace: their format identifies the provider, and some embed
        long encrypted reasoning state.
        """
        if provider_call_id not in self._trace_call_ids:
            self._trace_call_ids[provider_call_id] = f"call_{len(self._trace_call_ids) + 1}"
        return self._trace_call_ids[provider_call_id]

    def _preview(self, message: Message) -> dict[str, Any]:
        content = message.get("content")
        text, truncated = truncate(
            content if isinstance(content, str) else "", self.limits.preview_chars
        )
        return {"role": message["role"], "content": text, "truncated": truncated}

    def record_llm_call(self, response: LLMResponse) -> None:
        """Account for one model call and emit its event.

        Call this before appending the response to the conversation, so
        `input_upto` marks exactly what the model saw.
        """
        reference = reference_cost_usd(
            self.pricing,
            prompt_tokens=response.prompt_tokens,
            completion_tokens=response.completion_tokens,
            cache_read_tokens=response.cache_read_tokens or 0,
            cache_write_tokens=response.cache_write_tokens or 0,
        )
        actual = actual_cost_usd(self.pricing, reference)
        self.prompt_tokens += response.prompt_tokens
        self.completion_tokens += response.completion_tokens
        self.reference_cost_usd = round(self.reference_cost_usd + reference, 8)
        self.cost_usd = round(self.cost_usd + actual, 8)
        self.add_active_time(response.latency_ms)
        self.consecutive_rejections = 0

        input_upto = len(self.messages)
        # The previous model output is already in the trace as its own event.
        new_inputs = [
            m for m in self.messages[self._previewed_upto : input_upto] if m["role"] != "assistant"
        ]
        self._previewed_upto = input_upto
        content, truncated = truncate(response.content or "", self.limits.preview_chars)
        thinking, _ = truncate(response.thinking or "", self.limits.preview_chars)
        self.emitter.emit(
            "llm_call",
            {
                "step": self.steps,
                "model": self.config.model,
                "input_upto": input_upto,
                "input_preview": [self._preview(m) for m in new_inputs],
                "output": {
                    "content": content if response.content is not None else None,
                    "thinking": thinking if response.thinking is not None else None,
                    "tool_calls": [
                        {
                            "call_id": self.trace_call_id(call.call_id),
                            "tool": call.name,
                            "arguments": _display_arguments(call),
                        }
                        for call in response.tool_calls
                    ],
                    "truncated": truncated,
                },
                "prompt_tokens": response.prompt_tokens,
                "completion_tokens": response.completion_tokens,
                "cache_read_tokens": response.cache_read_tokens,
                "cache_write_tokens": response.cache_write_tokens,
                "cost_usd": actual,
                "reference_cost_usd": reference,
                "latency_ms": response.latency_ms,
            },
        )

    async def _dispatch(self, call: ToolCallRequest) -> ToolResult:
        if call.arguments is None:
            return ToolResult.failure("the arguments were not a valid JSON object")
        if call.name == SUBMIT_ANSWER:
            answer = call.arguments.get("answer")
            if not isinstance(answer, str) or not answer.strip():
                return ToolResult.failure("'answer' must be a non-empty string")
            self.final_answer = answer.strip()
            return ToolResult("Answer recorded.")
        tool = self.tools.get(call.name)
        if tool is None:
            if call.name in ALL_TOOL_NAMES:
                return ToolResult.failure(f"the tool {call.name!r} is not available to this agent")
            return ToolResult.failure(f"there is no tool named {call.name!r}")
        try:
            async with asyncio.timeout(TOOL_TIMEOUT_S):
                return await tool.run(call.arguments)
        except TimeoutError:
            return ToolResult.failure(
                f"the tool did not finish within {TOOL_TIMEOUT_S:.0f} seconds"
            )
        except Exception as error:  # A tool bug must not take the run down with it.
            return ToolResult.failure(f"{type(error).__name__}: {error}")

    async def execute_tool(self, call: ToolCallRequest) -> str:
        """Run one tool call, emit its events, and return the text the model sees."""
        text, _success = await self.execute_tool_detailed(call)
        return text

    async def execute_tool_detailed(self, call: ToolCallRequest) -> tuple[str, bool]:
        """As execute_tool, also saying whether the tool succeeded."""
        self.tool_calls += 1
        self.emitter.emit(
            "tool_call",
            {
                "step": self.steps,
                "call_id": self.trace_call_id(call.call_id),
                "tool": call.name,
                "arguments": _display_arguments(call),
            },
        )
        started = time.monotonic()
        result = await self._dispatch(call)
        latency_ms = int((time.monotonic() - started) * 1000)
        self.add_active_time(latency_ms)

        if result.success:
            text = result.output
        else:
            text = f"Error: {result.error}"
            if result.output:
                text = f"{text}\nOutput before the error:\n{result.output}"
        # The model and the trace see the same truncated text.
        text, truncated = truncate(text, self.limits.tool_output_chars)
        self.emitter.emit(
            "tool_result",
            {
                "step": self.steps,
                "call_id": self.trace_call_id(call.call_id),
                "tool": call.name,
                "output": text,
                "truncated": truncated,
                "success": result.success,
                "latency_ms": latency_ms,
                "error": result.error,
            },
        )
        return text, result.success


def _display_arguments(call: ToolCallRequest) -> dict[str, Any]:
    if call.arguments is not None:
        return call.arguments
    return {"_unparsed": call.raw_arguments}
