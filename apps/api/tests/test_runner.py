"""The agent loop, its limits, and the trace it emits. Every model here is scripted."""

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from arena.backends.claude_auth import SubscriptionAuthError
from arena.llm import LLMCallError, LLMResponse, RateLimitedError, ToolCallRequest
from arena.pricing import ModelNotAllowedError
from arena.run_context import RunLimits
from arena.runner import RunResult, run_agent
from arena.settings import get_settings
from arena.tools.base import TRUNCATION_NOTE
from tests.fakes import (
    ScriptedLLM,
    asks_for,
    make_config,
    make_pricing,
    make_settings,
    make_task,
    raw_tool_call,
    says,
    submits,
    tool_call,
)


@pytest.fixture(scope="module")
def validator() -> Draft202012Validator:
    schema = json.loads(get_settings().schema_path.read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


async def run(
    tmp_path: Path,
    llm: ScriptedLLM,
    *,
    limits: RunLimits | None = None,
    config: dict[str, object] | None = None,
    settings: dict[str, object] | None = None,
) -> RunResult:
    return await run_agent(
        make_config(**(config or {})),
        make_task(),
        llm=llm,
        settings=make_settings(tmp_path, **(settings or {})),
        limits=limits,
        pricing=make_pricing(),
    )


def types(result: RunResult) -> list[str]:
    return [event["type"] for event in result.events]


def payloads(result: RunResult, event_type: str) -> list[dict[str, Any]]:
    return [event["payload"] for event in result.events if event["type"] == event_type]


def finished(result: RunResult) -> dict[str, Any]:
    return payloads(result, "run_finished")[0]


CALCULATE = asks_for(tool_call("calculator", expression="6*7"))


async def test_tool_call_then_answer_produces_the_expected_trace(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(CALCULATE, submits("42")))

    assert types(result) == [
        "run_started",
        "step_started",
        "llm_call",
        "tool_call",
        "tool_result",
        "step_finished",
        "step_started",
        "llm_call",
        "tool_call",
        "tool_result",
        "step_finished",
        "run_finished",
        "score_computed",
    ]
    assert result.stop_reason == "answered"
    assert result.final_answer == "42"
    assert result.steps == 2
    assert payloads(result, "tool_result")[0]["output"] == "42"


async def test_every_event_validates_against_the_json_schema(
    tmp_path: Path, validator: Draft202012Validator
) -> None:
    scripts = [
        ScriptedLLM(CALCULATE, submits("42")),
        ScriptedLLM(says("42")),
        ScriptedLLM(LLMCallError("boom")),
        ScriptedLLM(asks_for(raw_tool_call("calculator", "{not json")), submits("1")),
        ScriptedLLM(CALCULATE, repeat_last=True),
    ]
    for llm in scripts:
        result = await run(tmp_path, llm)
        for event in result.events:
            errors = list(validator.iter_errors(event))
            assert not errors, (event["type"], errors)


async def test_seq_starts_at_zero_and_has_no_gaps(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(CALCULATE, CALCULATE, submits("42")))

    assert [event["seq"] for event in result.events] == list(range(len(result.events)))
    assert {event["run_id"] for event in result.events} == {result.run_id}


async def test_plain_text_reply_is_accepted_as_the_answer(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(says("  The answer is 42.  ")))

    assert result.stop_reason == "answered"
    assert result.final_answer == "The answer is 42."
    assert finished(result)["final_answer"] == "The answer is 42."


async def test_free_model_costs_nothing_but_reports_a_reference_cost(tmp_path: Path) -> None:
    llm = ScriptedLLM(
        asks_for(
            tool_call("calculator", expression="1+1"), prompt_tokens=1000, completion_tokens=200
        ),
        submits("2", prompt_tokens=2000, completion_tokens=100),
    )

    result = await run(tmp_path, llm)

    # Reference prices in the test table: $1 in, $5 out per million tokens.
    assert result.cost_usd == 0.0
    assert result.reference_cost_usd == pytest.approx((3000 * 1 + 300 * 5) / 1_000_000)
    assert result.total_tokens == 3300
    assert finished(result)["cost_usd"] == 0.0
    assert finished(result)["total_tokens"] == 3300
    assert [p["cost_usd"] for p in payloads(result, "llm_call")] == [0.0, 0.0]
    assert payloads(result, "step_finished")[0]["total_tokens"] == 1200


async def test_latency_is_active_time_not_wall_clock(tmp_path: Path) -> None:
    llm = ScriptedLLM(
        asks_for(tool_call("calculator", expression="1+1"), latency_ms=700),
        submits("2", latency_ms=300),
    )

    result = await run(tmp_path, llm)

    tool_ms = sum(p["latency_ms"] for p in payloads(result, "tool_result"))
    assert result.latency_ms == 1000 + tool_ms
    assert finished(result)["latency_ms"] == result.latency_ms


async def test_stops_at_max_steps(tmp_path: Path) -> None:
    llm = ScriptedLLM(CALCULATE, repeat_last=True)

    result = await run(tmp_path, llm, config={"max_steps": 3})

    assert result.stop_reason == "max_steps"
    assert llm.calls == 3
    assert result.steps == 3
    assert result.final_answer is None
    assert types(result)[-2:] == ["run_finished", "score_computed"]


async def test_stops_at_the_token_limit(tmp_path: Path) -> None:
    llm = ScriptedLLM(
        asks_for(tool_call("calculator", expression="1"), prompt_tokens=400, completion_tokens=200),
        repeat_last=True,
    )

    result = await run(tmp_path, llm, limits=RunLimits(max_total_tokens=1000))

    assert result.stop_reason == "max_tokens"
    assert llm.calls == 2
    assert result.total_tokens == 1200
    # The call that crossed the limit does not get to run its tools.
    assert len(payloads(result, "tool_call")) == 1


async def test_completion_is_capped_by_the_tokens_left(tmp_path: Path) -> None:
    llm = ScriptedLLM(
        asks_for(tool_call("calculator", expression="1"), prompt_tokens=600, completion_tokens=100),
        submits("1"),
    )

    await run(tmp_path, llm, limits=RunLimits(max_total_tokens=1000, max_completion_tokens=800))

    assert [request["max_tokens"] for request in llm.requests] == [800, 300]


async def test_stops_at_the_cost_limit(tmp_path: Path) -> None:
    # The paid test model costs $1000 per million input tokens, so 100 tokens is $0.10.
    llm = ScriptedLLM(
        asks_for(tool_call("calculator", expression="1"), prompt_tokens=100, completion_tokens=0),
        repeat_last=True,
    )

    result = await run(
        tmp_path,
        llm,
        limits=RunLimits(max_cost_usd=0.25),
        config={"model": "test/paid-model"},
        settings={"allow_paid_models": True},
    )

    assert result.stop_reason == "max_cost"
    assert llm.calls == 3
    assert result.cost_usd == pytest.approx(0.30)
    assert result.cost_usd == result.reference_cost_usd


async def test_stops_when_active_time_runs_out(tmp_path: Path) -> None:
    llm = ScriptedLLM(
        asks_for(tool_call("calculator", expression="1"), latency_ms=4000), repeat_last=True
    )

    result = await run(tmp_path, llm, limits=RunLimits(timeout_s=10))

    assert result.stop_reason == "timeout"
    assert llm.calls == 3


async def test_a_model_call_that_hangs_is_cut_off_at_the_time_limit(tmp_path: Path) -> None:
    async def hang() -> LLMResponse:
        await asyncio.sleep(30)
        return says("too late")

    result = await run(tmp_path, ScriptedLLM(hang), limits=RunLimits(timeout_s=0.2))

    assert result.stop_reason == "timeout"
    assert result.final_answer is None
    assert payloads(result, "error")[0]["recoverable"] is False


async def test_a_failed_model_call_ends_the_run_with_an_error(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(CALCULATE, LLMCallError("provider returned 500")))

    assert result.stop_reason == "error"
    assert not result.abandoned
    error = payloads(result, "error")[0]
    assert "provider returned 500" in error["message"]
    assert error["step"] == 2
    assert types(result)[-4:-1] == ["error", "step_finished", "run_finished"]


async def test_an_empty_reply_is_an_error_not_an_answer(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(says("   ")))

    assert result.stop_reason == "error"
    assert result.final_answer is None


async def test_a_rate_limit_marks_the_run_abandoned(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(CALCULATE, RateLimitedError("429", retry_after_s=12)))

    assert result.abandoned
    assert result.stop_reason == "error"
    assert payloads(result, "error")[0]["recoverable"] is True


async def test_a_crash_in_the_loop_still_ends_with_a_complete_trace(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(RuntimeError("bug in the loop")))

    assert result.stop_reason == "error"
    assert types(result)[-2:] == ["run_finished", "score_computed"]
    assert "bug in the loop" in payloads(result, "error")[0]["message"]


@pytest.mark.parametrize(
    ("call", "message"),
    [
        (tool_call("web_search", query="x"), "no tool named 'web_search'"),
        (raw_tool_call("calculator", "{broken"), "not a valid JSON object"),
        (tool_call("calculator", expression="__import__('os')"), "only the listed functions"),
        (tool_call("submit_answer", answer=""), "'answer' must be a non-empty string"),
    ],
)
async def test_a_bad_tool_call_fails_without_ending_the_run(
    tmp_path: Path, call: ToolCallRequest, message: str
) -> None:
    llm = ScriptedLLM(asks_for(call), submits("done"))

    result = await run(tmp_path, llm)

    first = payloads(result, "tool_result")[0]
    assert first["success"] is False
    assert message in first["error"]
    assert result.stop_reason == "answered"
    # The model was told about the failure.
    assert llm.requests[1]["messages"][-1]["content"].startswith("Error: ")


async def test_a_tool_the_config_does_not_enable_is_refused(tmp_path: Path) -> None:
    llm = ScriptedLLM(asks_for(tool_call("python_exec", code="print(1)")), submits("1"))

    result = await run(tmp_path, llm, config={"enabled_tools": ["calculator"]})

    assert payloads(result, "tool_result")[0]["error"] == (
        "the tool 'python_exec' is not available to this agent"
    )
    offered = [schema["function"]["name"] for schema in llm.requests[0]["tools"]]
    assert offered == ["calculator", "submit_answer"]


async def test_tool_output_is_capped_and_the_model_sees_the_same_text(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    (settings.fixtures_dir / "big.txt").write_text("x" * 5000, encoding="utf-8")
    llm = ScriptedLLM(asks_for(tool_call("read_file", path="big.txt")), submits("ok"))

    result = await run_agent(
        make_config(),
        make_task(),
        llm=llm,
        settings=settings,
        limits=RunLimits(tool_output_chars=300),
        pricing=make_pricing(),
    )

    shown = payloads(result, "tool_result")[0]
    assert shown["truncated"] is True
    assert shown["output"] == "x" * 300 + TRUNCATION_NOTE
    assert llm.requests[1]["messages"][-1]["content"] == shown["output"]


async def test_several_tool_calls_in_one_step_all_run_in_order(tmp_path: Path) -> None:
    llm = ScriptedLLM(
        asks_for(
            tool_call("calculator", "a", expression="2+2"),
            tool_call("calculator", "b", expression="3*3"),
        ),
        submits("13"),
    )

    result = await run(tmp_path, llm)

    assert [p["output"] for p in payloads(result, "tool_result")[:2]] == ["4", "9"]
    tool_messages = [m for m in llm.requests[1]["messages"] if m["role"] == "tool"]
    assert [m["tool_call_id"] for m in tool_messages] == ["a", "b"]
    assert result.steps == 2


async def test_an_answer_outranks_a_budget_used_up_by_the_same_call(tmp_path: Path) -> None:
    llm = ScriptedLLM(submits("42", prompt_tokens=5000, completion_tokens=10))

    result = await run(tmp_path, llm, limits=RunLimits(max_total_tokens=1000))

    assert result.stop_reason == "answered"
    assert result.final_answer == "42"


async def test_conversation_is_sent_in_order_and_previews_show_only_new_input(
    tmp_path: Path,
) -> None:
    llm = ScriptedLLM(CALCULATE, submits("42"))

    result = await run(tmp_path, llm)

    assert [m["role"] for m in llm.requests[0]["messages"]] == ["system", "user"]
    assert [m["role"] for m in llm.requests[1]["messages"]] == [
        "system",
        "user",
        "assistant",
        "tool",
    ]
    first, second = payloads(result, "llm_call")
    assert first["input_upto"] == 2
    assert [m["role"] for m in first["input_preview"]] == ["system", "user"]
    assert second["input_upto"] == 4
    assert [m["role"] for m in second["input_preview"]] == ["tool"]
    assert second["input_preview"][0]["content"] == "42"


async def test_temperature_is_passed_through_only_as_configured(tmp_path: Path) -> None:
    unset, fixed = ScriptedLLM(says("1")), ScriptedLLM(says("1"))

    await run(tmp_path, unset)
    await run(tmp_path, fixed, config={"temperature": 0.2})

    assert unset.requests[0]["temperature"] is None
    assert fixed.requests[0]["temperature"] == 0.2


async def test_run_started_carries_the_config_snapshot(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(says("1")))

    started = payloads(result, "run_started")[0]
    assert started["task_id"] == "test-task"
    assert started["config"]["id"] == "test-agent@v1"
    assert started["config"]["backend"] == "litellm"


@pytest.mark.parametrize(
    ("model", "reason"),
    [
        ("test/paid-model", "billed per token"),
        ("test/not-in-the-table", "no entry in the pricing table"),
        ("test/subscription-model", "may only run on the agent_sdk backend"),
    ],
)
async def test_a_model_that_is_not_free_is_refused_before_any_call(
    tmp_path: Path, model: str, reason: str
) -> None:
    llm = ScriptedLLM(says("should never be asked"))

    with pytest.raises(ModelNotAllowedError, match=reason):
        await run(tmp_path, llm, config={"model": model})

    assert llm.calls == 0


async def test_an_unknown_model_is_refused_even_with_the_paid_override(tmp_path: Path) -> None:
    llm = ScriptedLLM(says("should never be asked"))

    with pytest.raises(ModelNotAllowedError, match="no entry"):
        await run(
            tmp_path,
            llm,
            config={"model": "test/not-in-the-table"},
            settings={"allow_paid_models": True},
        )

    assert llm.calls == 0


async def test_a_claude_config_without_a_subscription_login_is_refused(tmp_path: Path) -> None:
    llm = ScriptedLLM(says("x"))

    with pytest.raises(SubscriptionAuthError, match="CLAUDE_CODE_OAUTH_TOKEN is not set"):
        await run(
            tmp_path, llm, config={"model": "test/subscription-model", "backend": "agent_sdk"}
        )

    assert llm.calls == 0
