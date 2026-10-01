"""Regression tests built from responses real providers returned on 2026-10-02.

The files in tests/recorded/ are what Groq and Gemini actually sent during the
first real runs. Each test pins the handling of one behaviour seen there.
"""

import json
from pathlib import Path
from typing import Any

import litellm
import pytest
from litellm.exceptions import BadRequestError, RateLimitError, ServiceUnavailableError

from arena.llm import (
    InvalidToolCallError,
    LiteLLMClient,
    LLMCallError,
    ProviderUnavailableError,
    RateLimitedError,
    provider_error,
    response_from_litellm,
    translate_error,
)
from arena.run_context import RunLimits
from arena.runner import RunResult, run_agent
from tests.fakes import (
    ScriptedLLM,
    asks_for,
    make_config,
    make_pricing,
    make_settings,
    make_task,
    submits,
    tool_call,
)

RECORDED = Path(__file__).parent / "recorded"
GROQ = "groq/openai/gpt-oss-120b"
GEMINI = "gemini/gemini-3.8-flash"

GROQ_TOOL_USE_FAILED = (RECORDED / "groq_tool_use_failed.txt").read_text(encoding="utf-8")
GEMINI_503 = (RECORDED / "gemini_503_unavailable.txt").read_text(encoding="utf-8")
# Groq's 429 as received, with the account id as the client redacts it.
GROQ_429 = (
    'litellm.RateLimitError: RateLimitError: GroqException - {"error":{"message":"Rate limit '
    "reached for model `openai/gpt-oss-120b` in organization `org_01abcDEF234ghi567` service "
    "tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7460, Requested 1090. Please "
    'try again in 4.125s.","type":"tokens","code":"rate_limit_exceeded"}}'
)


def recorded_response(name: str) -> Any:  # noqa: ANN401
    body = json.loads((RECORDED / name).read_text(encoding="utf-8"))
    return litellm.ModelResponse(**body)


def payloads(result: RunResult, event_type: str) -> list[dict[str, Any]]:
    return [event["payload"] for event in result.events if event["type"] == event_type]


async def run(tmp_path: Path, llm: ScriptedLLM, **config: object) -> RunResult:
    return await run_agent(
        make_config(**config),
        make_task(),
        llm=llm,
        settings=make_settings(tmp_path),
        limits=RunLimits(),
        pricing=make_pricing(),
    )


# ------------------------------------------------- Groq: built-in `python` tool
#
# gpt-oss-120b has a built-in tool named `python`. On a task that needs code it
# calls that instead of python_exec, with raw code where JSON arguments belong.
# Groq rejects the whole response with HTTP 400 and code tool_use_failed.


def test_groq_tool_use_failed_is_recognised_from_the_real_error_text() -> None:
    error = BadRequestError(message=GROQ_TOOL_USE_FAILED, model=GROQ, llm_provider="groq")

    detail = provider_error(error)
    translated = translate_error(error, latency_ms=480)

    assert detail["code"] == "tool_use_failed"
    assert '"name": "python"' in detail["failed_generation"]
    assert isinstance(translated, InvalidToolCallError)
    assert translated.provider_message == (
        "Model called python tool which was not enabled for this request"
    )
    assert translated.latency_ms == 480


async def test_the_client_raises_invalid_tool_call_for_the_real_groq_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def reject(**_params: object) -> None:
        raise BadRequestError(message=GROQ_TOOL_USE_FAILED, model=GROQ, llm_provider="groq")

    monkeypatch.setattr(litellm, "acompletion", reject)

    with pytest.raises(InvalidToolCallError, match="python tool which was not enabled"):
        await LiteLLMClient().complete(
            model=GROQ, messages=[], tools=[], temperature=None, max_tokens=64
        )


async def test_a_rejected_tool_call_is_reported_to_the_model_and_the_run_continues(
    tmp_path: Path,
) -> None:
    rejection = InvalidToolCallError(
        "Model called python tool which was not enabled for this request", latency_ms=500
    )
    llm = ScriptedLLM(rejection, asks_for(tool_call("calculator", expression="6*7")), submits("42"))

    result = await run(tmp_path, llm)

    assert result.stop_reason == "answered"
    assert not result.abandoned
    assert result.steps == 3
    error = payloads(result, "error")[0]
    assert error["recoverable"] is True
    assert "python tool which was not enabled" in error["message"]
    notice = llm.requests[1]["messages"][-1]
    assert notice["role"] == "user"
    assert (
        "The only tools that exist are: calculator, python_exec, search_docs, read_file, "
        in (notice["content"])
    )
    assert "submit_answer" in notice["content"]
    # The rejected call's time still counts as active time.
    assert result.latency_ms >= 500


async def test_a_model_that_keeps_making_the_rejected_call_is_stopped_after_three(
    tmp_path: Path,
) -> None:
    rejection = InvalidToolCallError("Model called python tool which was not enabled", 100)
    llm = ScriptedLLM(rejection, repeat_last=True)

    result = await run(tmp_path, llm)

    assert llm.calls == 3
    assert result.stop_reason == "error"
    # This is the model's failure, so the run stands and is scored as a failure.
    assert not result.abandoned
    assert payloads(result, "error")[-1]["recoverable"] is False
    assert "3 unusable tool calls in a row" in payloads(result, "error")[-1]["message"]


async def test_the_rejection_count_resets_after_a_usable_response(tmp_path: Path) -> None:
    rejection = InvalidToolCallError("Model called python tool which was not enabled", 100)
    calculate = asks_for(tool_call("calculator", expression="1+1"))
    llm = ScriptedLLM(rejection, rejection, calculate, rejection, rejection, submits("2"))

    result = await run(tmp_path, llm, max_steps=10)

    assert result.stop_reason == "answered"
    assert llm.calls == 6


def test_a_real_groq_tool_call_response_is_parsed() -> None:
    response = response_from_litellm(recorded_response("groq_gpt_oss_tool_call.json"), 840)

    assert response.content is None
    assert [(call.name, call.arguments) for call in response.tool_calls] == [
        ("calculator", {"expression": "(37 * 4.85) + (12 * 13.40)"})
    ]
    assert (response.prompt_tokens, response.completion_tokens) == (476, 105)
    # Groq reports no cache details; that must come through as "not reported".
    assert response.cache_read_tokens is None
    assert response.message["role"] == "assistant"
    assert response.message["tool_calls"][0]["function"]["name"] == "calculator"


# --------------------------------------------- Gemini: outages and thought signatures


def test_gemini_503_is_a_provider_outage_not_an_agent_failure() -> None:
    error = ServiceUnavailableError(message=GEMINI_503, model=GEMINI, llm_provider="gemini")

    translated = translate_error(error, latency_ms=11_000)

    assert isinstance(translated, ProviderUnavailableError)
    assert not isinstance(translated, RateLimitedError)
    assert "high demand" in str(translated)


def test_a_rate_limit_is_recognised_and_the_account_id_is_removed() -> None:
    error = RateLimitError(message=GROQ_429, model=GROQ, llm_provider="groq")

    translated = translate_error(error, latency_ms=200)

    assert isinstance(translated, RateLimitedError)
    assert "org_01abcDEF234ghi567" not in str(translated)
    assert "org_<redacted>" in str(translated)
    assert "tokens per minute" in str(translated)


def test_an_ordinary_bad_request_stays_a_plain_failure() -> None:
    error = BadRequestError(
        message='GroqException - {"error":{"message":"bad schema","code":"invalid_request"}}',
        model=GROQ,
        llm_provider="groq",
    )

    translated = translate_error(error, latency_ms=10)

    assert type(translated) is LLMCallError


@pytest.mark.parametrize(
    "failure",
    [
        ProviderUnavailableError("ServiceUnavailableError: " + GEMINI_503),
        RateLimitedError("RateLimitError: " + GROQ_429, retry_after_s=4.1),
    ],
)
async def test_a_provider_outage_abandons_the_run_so_it_is_re_run(
    tmp_path: Path, failure: Exception
) -> None:
    llm = ScriptedLLM(asks_for(tool_call("calculator", expression="1+1")), failure)

    result = await run(tmp_path, llm)

    assert result.abandoned
    assert result.stop_reason == "error"
    assert payloads(result, "error")[0]["recoverable"] is True


def test_a_real_gemini_response_keeps_its_thought_signature_for_the_next_request() -> None:
    response = response_from_litellm(
        recorded_response("gemini_tool_call_with_thought_signature.json"), 26_311
    )

    assert [call.name for call in response.tool_calls] == ["python_exec"]
    assert (response.prompt_tokens, response.completion_tokens) == (682, 178)
    # Gemini refuses the next request unless this comes back unchanged.
    returned = json.dumps(response.message)
    assert "thought_signature" in returned
    assert response.tool_calls[0].call_id in returned


async def test_provider_call_ids_stay_out_of_the_trace(tmp_path: Path) -> None:
    gemini = response_from_litellm(
        recorded_response("gemini_tool_call_with_thought_signature.json"), 100
    )
    provider_id = gemini.tool_calls[0].call_id
    assert "__thought__" in provider_id
    llm = ScriptedLLM(gemini, submits("east", call_id="fc_04c0f915-e773-44ec"))

    result = await run(tmp_path, llm)

    serialized = json.dumps(result.events)
    assert "__thought__" not in serialized
    assert "fc_04c0f915" not in serialized
    assert [p["call_id"] for p in payloads(result, "tool_call")] == ["call_1", "call_2"]
    assert [p["call_id"] for p in payloads(result, "tool_result")] == ["call_1", "call_2"]
    assert payloads(result, "llm_call")[0]["output"]["tool_calls"][0]["call_id"] == "call_1"
    # The provider still gets its own id back in the conversation.
    assert llm.requests[1]["messages"][-1]["tool_call_id"] == provider_id


def test_the_limits_fit_one_request_inside_groqs_tokens_per_minute() -> None:
    limits = RunLimits()
    groq_tokens_per_minute = 8_000
    largest_prompt_seen = 1_037  # The biggest request in the first real runs.

    assert limits.max_completion_tokens + 4 * largest_prompt_seen < groq_tokens_per_minute
    assert limits.max_total_tokens == 2 * groq_tokens_per_minute
