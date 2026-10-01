"""A scripted stand-in for ClaudeSDKClient.

It replays a session in the order the real Claude Code process was observed to
emit it on 2026-10-02: raw stream events for each model response, with the tool
hooks and handlers starting before the response's message_stop arrives.
No test reaches Claude through this.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from claude_agent_sdk.types import (
    AssistantMessage,
    RateLimitEvent,
    RateLimitInfo,
    ResultMessage,
    StreamEvent,
    SystemMessage,
)

from arena.backends.agent_sdk import SessionSpec
from arena.backends.claude_auth import mcp_name

SESSION = "session-test"


@dataclass
class Turn:
    """One model response."""

    text: str = ""
    tools: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    input_tokens: int = 1000
    output_tokens: int = 50
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


def calls(name: str, **arguments: object) -> Turn:
    return Turn(tools=[(name, dict(arguments))])


def submits(
    answer: str,
    *,
    input_tokens: int = 1000,
    output_tokens: int = 50,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> Turn:
    return Turn(
        tools=[("submit_answer", {"answer": answer})],
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
    )


class FakeSdkClient:
    def __init__(
        self,
        spec: SessionSpec,
        turns: list[Turn],
        *,
        repeat_last: bool = False,
        init: dict[str, Any] | None = None,
        rate_limit: RateLimitInfo | None = None,
        assistant_error: str | None = None,
    ) -> None:
        self.spec = spec
        self._turns = turns
        self._repeat_last = repeat_last
        self._init = init
        self._rate_limit = rate_limit
        self._assistant_error = assistant_error
        self.prompt: str | None = None
        self.model_calls = 0
        self.interrupted = False
        self.tool_results: list[dict[str, Any]] = []

    async def __aenter__(self) -> "FakeSdkClient":
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> Any:  # noqa: ANN401
        return None

    async def query(self, prompt: str) -> None:
        self.prompt = prompt

    async def interrupt(self) -> None:
        self.interrupted = True

    def _event(self, event: dict[str, Any]) -> StreamEvent:
        return StreamEvent(uuid="u", session_id=SESSION, event=event)

    def _init_data(self) -> dict[str, Any]:
        if self._init is not None:
            return self._init
        return {
            "apiKeySource": "none",
            "tools": [mcp_name(name) for name in self.spec.tools],
            "model": self.spec.model,
            "claude_code_version": "2.1.286",
        }

    async def _run_tools(self, turn_index: int, turn: Turn) -> bool:
        """Run a response's tools one after another, as Claude Code does.
        Returns False if a hook ended the session."""
        for position, (name, arguments) in enumerate(turn.tools):
            tool_use_id = f"toolu_{turn_index}_{position}"
            hook_input = {"tool_name": mcp_name(name), "tool_input": arguments}
            decision = await self.spec.pre_tool_use(hook_input, tool_use_id, None)
            if decision.get("hookSpecificOutput", {}).get("permissionDecision") == "deny":
                continue
            if self.interrupted:
                return False
            handler = self.spec.tools[name][2]
            self.tool_results.append(await handler(arguments))
            after = await self.spec.post_tool_use(hook_input, tool_use_id, None)
            if after.get("continue_") is False:
                return False
        return True

    async def receive_response(self) -> AsyncIterator[Any]:
        yield SystemMessage(subtype="init", data=self._init_data())
        index = 0
        hook_stopped = False
        while True:
            if index >= len(self._turns):
                if not self._repeat_last:
                    break
                turn = self._turns[-1]
            else:
                turn = self._turns[index]
            if index >= self.spec.max_turns:
                yield self._result("error_max_turns", is_error=True)
                return

            self.model_calls += 1
            if self._assistant_error is not None:
                error: Any = self._assistant_error
                yield AssistantMessage(content=[], model=self.spec.model, error=error)
                yield self._result("error_during_execution", is_error=True)
                return
            usage = {
                "input_tokens": turn.input_tokens,
                "cache_read_input_tokens": turn.cache_read_tokens,
                "cache_creation_input_tokens": turn.cache_write_tokens,
                "output_tokens": 5,
            }
            yield self._event({"type": "message_start", "message": {"usage": usage}})
            block = 0
            if turn.text:
                yield self._event(
                    {
                        "type": "content_block_start",
                        "index": block,
                        "content_block": {"type": "text"},
                    }
                )
                yield self._event(
                    {
                        "type": "content_block_delta",
                        "index": block,
                        "delta": {"type": "text_delta", "text": turn.text},
                    }
                )
                yield self._event({"type": "content_block_stop", "index": block})
                block += 1
            for position, (name, arguments) in enumerate(turn.tools):
                content_block = {
                    "type": "tool_use",
                    "id": f"toolu_{index}_{position}",
                    "name": mcp_name(name),
                    "input": {},
                }
                yield self._event(
                    {"type": "content_block_start", "index": block, "content_block": content_block}
                )
                yield self._event(
                    {
                        "type": "content_block_delta",
                        "index": block,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": json.dumps(arguments),
                        },
                    }
                )
                yield self._event({"type": "content_block_stop", "index": block})
                block += 1

            # Claude Code starts the tools before the response has finished streaming.
            tools_task = asyncio.create_task(self._run_tools(index, turn))
            await asyncio.sleep(0)
            yield self._event(
                {"type": "message_delta", "usage": {"output_tokens": turn.output_tokens}}
            )
            if self._rate_limit is not None:
                yield RateLimitEvent(rate_limit_info=self._rate_limit, uuid="u", session_id=SESSION)
            yield self._event({"type": "message_stop"})

            keep_going = await tools_task
            if self.interrupted:
                yield self._result("error_during_execution", is_error=True)
                return
            if not keep_going:
                hook_stopped = True
                break
            if not turn.tools:
                break
            index += 1
        yield self._result(
            "success", is_error=False, terminal="hook_stopped" if hook_stopped else None
        )

    def _result(
        self, subtype: str, *, is_error: bool, terminal: str | None = None
    ) -> ResultMessage:
        return ResultMessage(
            subtype=subtype,
            duration_ms=10,
            duration_api_ms=8,
            is_error=is_error,
            num_turns=self.model_calls,
            session_id=SESSION,
            total_cost_usd=0.0123,
            terminal_reason=terminal,
        )
