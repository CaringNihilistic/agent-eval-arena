"""The model-call boundary used by the LiteLLM backend.

Everything above this file talks to `LLMClient`, so tests can swap in a scripted
fake and never reach a real model.
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
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
    # The model's thinking, when the provider returns it. Shown only after a vote.
    thinking: str | None = None


class LLMCallError(Exception):
    """The provider rejected or failed the call."""


class ProviderUnavailableError(LLMCallError):
    """The provider could not serve the call: rate limit, overload, outage, or a
    network failure. Not the agent's fault, so the run is abandoned and re-run."""

    def __init__(self, message: str, retry_after_s: float | None = None) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


class RateLimitedError(ProviderUnavailableError):
    """The provider's rate limit was hit."""


class InvalidToolCallError(LLMCallError):
    """The provider threw away the model's response because its tool call was
    unusable: a tool that does not exist, or arguments that are not JSON.

    Most providers hand such a call to us and we answer it with an error result.
    Some reject the whole response instead. Either way the model is told and gets
    to try again, so the outcome is the same across providers.
    """

    def __init__(self, provider_message: str, latency_ms: int) -> None:
        super().__init__(provider_message)
        self.provider_message = provider_message
        self.latency_ms = latency_ms


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


_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)
# Provider errors can name the account. That does not belong in a trace.
_ACCOUNT_ID = re.compile(r"org_[A-Za-z0-9]+")


def provider_error(error: Exception) -> dict[str, Any]:
    """The provider's own error object, when the exception text carries one."""
    match = _JSON_OBJECT.search(str(error))
    if match is None:
        return {}
    try:
        body = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    inner = body.get("error") if isinstance(body, dict) else None
    return inner if isinstance(inner, dict) else {}


def transient_errors() -> tuple[type[Exception], ...]:
    """LiteLLM errors that mean "try again later", not "the request was wrong"."""
    from litellm import exceptions

    return (
        exceptions.RateLimitError,
        exceptions.ServiceUnavailableError,
        exceptions.InternalServerError,
        exceptions.APIConnectionError,
        exceptions.Timeout,
    )


def translate_error(error: Exception, latency_ms: int) -> LLMCallError:
    """Sort a LiteLLM failure into: retry later, tell the model, or give up."""
    from litellm.exceptions import RateLimitError

    text = _ACCOUNT_ID.sub("org_<redacted>", f"{type(error).__name__}: {error}")
    if isinstance(error, RateLimitError):
        return RateLimitedError(text, _retry_after(error))
    if isinstance(error, transient_errors()):
        return ProviderUnavailableError(text, _retry_after(error))
    detail = provider_error(error)
    if detail.get("code") == "tool_use_failed":
        return InvalidToolCallError(str(detail.get("message", "invalid tool call")), latency_ms)
    return LLMCallError(text)


class LiteLLMClient:
    """Calls a model through LiteLLM. No retries here: the recorder owns backoff.

    With `dump_dir` set, each raw provider response is also written there as JSON,
    for debugging and for building regression fixtures from real responses.
    """

    def __init__(self, dump_dir: Path | None = None) -> None:
        # Imported here, not at module level: it takes seconds, and doing it before
        # a run starts keeps that time out of the run's wall clock. LiteLLM also
        # prints help text and tracebacks on failure; the trace records the error.
        import litellm

        litellm.suppress_debug_info = True
        logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)
        self._dump_dir = dump_dir
        self._dumped = 0

    def _dump(self, model: str, response: Any) -> None:  # noqa: ANN401
        if self._dump_dir is None:
            return
        self._dump_dir.mkdir(parents=True, exist_ok=True)
        self._dumped += 1
        name = f"{model.replace('/', '_')}-{self._dumped:02d}.json"
        (self._dump_dir / name).write_text(
            json.dumps(response.model_dump(), indent=2, default=str), encoding="utf-8"
        )

    async def complete(
        self,
        *,
        model: str,
        messages: list[Message],
        tools: list[ToolSchema],
        temperature: float | None,
        max_tokens: int,
    ) -> LLMResponse:
        import litellm

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
        except Exception as error:
            raise translate_error(error, int((time.monotonic() - started) * 1000)) from error
        latency_ms = int((time.monotonic() - started) * 1000)
        self._dump(model, response)
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
