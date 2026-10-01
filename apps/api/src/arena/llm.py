"""The model-call boundary used by the LiteLLM backend.

Everything above this file talks to `LLMClient`, so tests can swap in a scripted
fake and never reach a real model.
"""

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Protocol

Message = dict[str, Any]
ToolSchema = dict[str, Any]


@dataclass(frozen=True)
class ToolCallRequest:
    call_id: str
    name: str
    # None when the model produced arguments that are not a JSON object.
    arguments: dict[str, Any] | None
    raw_arguments: str


@dataclass(frozen=True)
class LLMResponse:
    # The assistant message exactly as the provider returned it. It goes back into
    # the conversation unchanged, because some providers require their reasoning
    # fields to be returned verbatim.
    message: Message
    content: str | None
    tool_calls: list[ToolCallRequest]
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None


class LLMCallError(Exception):
    """The provider rejected or failed the call."""


class RateLimitedError(LLMCallError):
    """The provider's rate limit was hit. Not the agent's fault: the run is abandoned."""

    def __init__(self, message: str, retry_after_s: float | None = None) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


class LLMClient(Protocol):
    async def complete(
        self,
        *,
        model: str,
        messages: list[Message],
        tools: list[ToolSchema],
        temperature: float | None,
        max_tokens: int,
    ) -> LLMResponse: ...


def parse_arguments(raw: str | None) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _retry_after(error: Exception) -> float | None:
    headers = getattr(getattr(error, "response", None), "headers", None)
    value = headers.get("retry-after") if headers is not None else None
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


class LiteLLMClient:
    """Calls a model through LiteLLM. No retries here: the recorder owns backoff."""

    async def complete(
        self,
        *,
        model: str,
        messages: list[Message],
        tools: list[ToolSchema],
        temperature: float | None,
        max_tokens: int,
    ) -> LLMResponse:
        # Imported lazily: it is slow to import and most tests never need it.
        import litellm
        from litellm.exceptions import RateLimitError

        # LiteLLM prints its own help text and tracebacks on failure; the trace
        # already records the error.
        litellm.suppress_debug_info = True
        logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)

        params: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "max_tokens": max_tokens,
            "num_retries": 0,
        }
        # Omitted when null: some models reject the parameter outright.
        if temperature is not None:
            params["temperature"] = temperature

        started = time.monotonic()
        try:
            response = await litellm.acompletion(**params)
        except RateLimitError as error:
            raise RateLimitedError(str(error), _retry_after(error)) from error
        except Exception as error:
            raise LLMCallError(f"{type(error).__name__}: {error}") from error
        latency_ms = int((time.monotonic() - started) * 1000)
        return response_from_litellm(response, latency_ms)


def response_from_litellm(response: Any, latency_ms: int) -> LLMResponse:  # noqa: ANN401
    message = response.choices[0].message
    usage = response.usage
    details = getattr(usage, "prompt_tokens_details", None)
    tool_calls = [
        ToolCallRequest(
            call_id=call.id,
            name=call.function.name or "",
            arguments=parse_arguments(call.function.arguments),
            raw_arguments=call.function.arguments or "",
        )
        for call in (message.tool_calls or [])
    ]
    return LLMResponse(
        message=message.model_dump(exclude_none=True),
        content=message.content,
        tool_calls=tool_calls,
        prompt_tokens=int(usage.prompt_tokens),
        completion_tokens=int(usage.completion_tokens),
        latency_ms=latency_ms,
        cache_read_tokens=getattr(details, "cached_tokens", None),
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", None),
    )
