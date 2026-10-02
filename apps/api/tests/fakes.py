"""Test doubles. No test may reach a real model; this scripted client stands in for one."""

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from arena.config import AgentConfig, Task
from arena.llm import LLMResponse, Message, ToolCallRequest, ToolSchema
from arena.pricing import PricingTable
from arena.settings import Settings

Step = LLMResponse | Exception | Callable[[], Any]


class ScriptedLLM:
    """Returns pre-written responses in order and records every request."""

    def __init__(self, *script: Step, repeat_last: bool = False) -> None:
        self._script = list(script)
        self._repeat_last = repeat_last
        self.requests: list[dict[str, Any]] = []

    @property
    def calls(self) -> int:
        return len(self.requests)

    async def complete(
        self,
        *,
        model: str,
        messages: list[Message],
        tools: list[ToolSchema],
        temperature: float | None,
        max_tokens: int,
    ) -> LLMResponse:
        self.requests.append(
            {
                "model": model,
                # A copy: the conversation list keeps growing after this call.
                "messages": [dict(m) for m in messages],
                "tools": tools,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
        )
        index = self.calls - 1
        if index >= len(self._script):
            if not self._repeat_last:
                raise AssertionError("the model was called more often than the script allows")
            index = len(self._script) - 1
        step = self._script[index]
        if isinstance(step, Exception):
            raise step
        if isinstance(step, LLMResponse):
            return step
        result = step()
        if asyncio.iscoroutine(result):
            result = await result
        assert isinstance(result, LLMResponse)
        return result


def tool_call(name: str, call_id: str = "call_1", **arguments: object) -> ToolCallRequest:
    return ToolCallRequest(call_id, name, dict(arguments), json.dumps(arguments))


def raw_tool_call(name: str, raw: str, call_id: str = "call_1") -> ToolCallRequest:
    """A call whose arguments are not valid JSON."""
    return ToolCallRequest(call_id, name, None, raw)


def asks_for(
    *calls: ToolCallRequest,
    content: str | None = None,
    prompt_tokens: int = 100,
    completion_tokens: int = 20,
    latency_ms: int = 50,
) -> LLMResponse:
    message: Message = {
        "role": "assistant",
        "content": content,
        "tool_calls": [
            {
                "id": call.call_id,
                "type": "function",
                "function": {"name": call.name, "arguments": call.raw_arguments},
            }
            for call in calls
        ],
    }
    return LLMResponse(
        message=message,
        content=content,
        tool_calls=list(calls),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
    )


def says(content: str, **usage: int) -> LLMResponse:
    return LLMResponse(
        message={"role": "assistant", "content": content},
        content=content,
        tool_calls=[],
        prompt_tokens=usage.get("prompt_tokens", 100),
        completion_tokens=usage.get("completion_tokens", 20),
        latency_ms=usage.get("latency_ms", 50),
    )


def submits(
    answer: str,
    call_id: str = "call_submit",
    *,
    prompt_tokens: int = 100,
    completion_tokens: int = 20,
    latency_ms: int = 50,
) -> LLMResponse:
    return asks_for(
        tool_call("submit_answer", call_id, answer=answer),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
    )


def make_config(**overrides: object) -> AgentConfig:
    fields: dict[str, Any] = {
        "name": "test-agent",
        "version": 1,
        "display_name": "Test agent",
        "backend": "litellm",
        "model": "test/free-model",
        "provider": "test",
        "model_family": "test",
        "system_prompt": "Solve the task.",
        "enabled_tools": ["calculator", "python_exec", "search_docs", "read_file"],
        "max_steps": 6,
        "temperature": None,
    }
    return AgentConfig.model_validate({**fields, **overrides})


def make_task(**overrides: object) -> Task:
    fields: dict[str, Any] = {
        "id": "test-task",
        "title": "A test task",
        "category": "math",
        "difficulty": "easy",
        "prompt": "What is 6 times 7?",
        "required_tools": ["calculator"],
        "scorer_type": "exact",
        "scorer_config": {"expected": "42"},
        "examples": {"correct": ["42"], "wrong": ["41"]},
    }
    return Task.model_validate({**fields, **overrides})


def make_pricing() -> PricingTable:
    reference = {"source": "https://example.test/pricing", "checked": "2026-10-02"}
    return PricingTable.model_validate(
        {
            "models": {
                "test/free-model": {
                    "provider": "test",
                    "billing": "free",
                    "backends": ["litellm"],
                    "reference": {"input_per_mtok": 1.0, "output_per_mtok": 5.0, **reference},
                },
                "test/paid-model": {
                    "provider": "test",
                    "billing": "paid",
                    "backends": ["litellm"],
                    "reference": {"input_per_mtok": 1000.0, "output_per_mtok": 5000.0, **reference},
                },
                "test/subscription-model": {
                    "provider": "test",
                    "billing": "subscription",
                    "backends": ["agent_sdk"],
                    "reference": {
                        "input_per_mtok": 2.0,
                        "output_per_mtok": 10.0,
                        "cache_read_per_mtok": 0.2,
                        "cache_write_per_mtok": 2.5,
                        **reference,
                    },
                },
            }
        }
    )


def make_settings(tmp_path: Path, **overrides: object) -> Settings:
    fixtures = tmp_path / "fixtures"
    corpus = tmp_path / "corpus"
    fixtures.mkdir(exist_ok=True)
    corpus.mkdir(exist_ok=True)
    values: dict[str, Any] = {
        "sandbox_url": None,
        "fixtures_dir": fixtures,
        "corpus_dir": corpus,
        "allow_paid_models": False,
    }
    return Settings(**{**values, **overrides})
