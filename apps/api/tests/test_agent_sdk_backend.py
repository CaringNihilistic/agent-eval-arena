"""The Claude subscription backend, driven by a scripted SDK client.

No test here reaches Claude. The scripted client replays events in the order a
real session was observed to produce them.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk.types import RateLimitInfo
from jsonschema import Draft202012Validator, FormatChecker

from arena.backends.agent_sdk import HARNESS_ENV, AgentSdkBackend, SessionSpec, real_client
from arena.backends.claude_auth import (
    FORBIDDEN_VARIABLES,
    TOKEN_VARIABLE,
    SubscriptionAuthError,
    check_environment,
)
from arena.llm import ToolCallRequest
from arena.run_context import RunLimits
from arena.runner import RunResult, run_agent, select_backend
from arena.settings import get_settings
from tests import fakes
from tests.fake_sdk import FakeSdkClient, Turn, calls, submits

SUBSCRIPTION_ENV = {TOKEN_VARIABLE: "test-token-not-a-real-credential"}
MODEL = "test/subscription-model"


class Harness:
    """Builds the backend around a scripted client and remembers what was asked of it."""

    def __init__(self, turns: list[Turn], **client_options: Any) -> None:  # noqa: ANN401
        self.turns = turns
        self.client_options = client_options
        self.client: FakeSdkClient | None = None
        self.spec: SessionSpec | None = None
        self.backend = AgentSdkBackend(client_factory=self._factory, env=SUBSCRIPTION_ENV)

    def _factory(self, spec: SessionSpec) -> FakeSdkClient:
        self.spec = spec
        self.client = FakeSdkClient(spec, self.turns, **self.client_options)
        return self.client

    @property
    def model_calls(self) -> int:
        return self.client.model_calls if self.client else 0


async def run(
    tmp_path: Path,
    harness: Harness,
    *,
    limits: RunLimits | None = None,
    **config: object,
) -> RunResult:
    return await run_agent(
        fakes.make_config(backend="agent_sdk", model=MODEL, **config),
        fakes.make_task(),
        llm=None,
        settings=fakes.make_settings(tmp_path),
        limits=limits,
        pricing=fakes.make_pricing(),
        backend=harness.backend,
    )


def types(result: RunResult) -> list[str]:
    return [event["type"] for event in result.events]


def payloads(result: RunResult, event_type: str) -> list[dict[str, Any]]:
    return [event["payload"] for event in result.events if event["type"] == event_type]


# ------------------------------------------------------------- same trace, same rules


async def test_the_trace_matches_the_litellm_backend_event_for_event(tmp_path: Path) -> None:
    claude = await run(tmp_path, Harness([calls("calculator", expression="6*7"), submits("42")]))
    litellm = await run_agent(
        fakes.make_config(),
        fakes.make_task(),
        llm=fakes.ScriptedLLM(
            fakes.asks_for(fakes.tool_call("calculator", expression="6*7")), fakes.submits("42")
        ),
        settings=fakes.make_settings(tmp_path),
        pricing=fakes.make_pricing(),
    )

    assert types(claude) == types(litellm)
    assert claude.stop_reason == litellm.stop_reason == "answered"
    assert claude.final_answer == litellm.final_answer == "42"
    assert claude.steps == litellm.steps == 2
    for event_type in ("tool_call", "tool_result"):
        for ours, theirs in zip(
            payloads(claude, event_type), payloads(litellm, event_type), strict=True
        ):
            ignore = {"latency_ms"}
            assert {k: v for k, v in ours.items() if k not in ignore} == {
                k: v for k, v in theirs.items() if k not in ignore
            }


async def test_every_event_validates_against_the_json_schema(tmp_path: Path) -> None:
    schema = json.loads(get_settings().schema_path.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    scripts = [
        [calls("calculator", expression="6*7"), submits("42")],
        [Turn(text="The answer is 42.")],
        [calls("calculator", expression="import os")],
    ]

    for turns in scripts:
        result = await run(tmp_path, Harness(turns, repeat_last=True), max_steps=3)
        for event in result.events:
            errors = list(validator.iter_errors(event))
            assert not errors, (event["type"], errors)
        assert [event["seq"] for event in result.events] == list(range(len(result.events)))


async def test_tool_events_come_after_the_model_call_that_asked_for_them(tmp_path: Path) -> None:
    # The scripted client starts the tool before message_stop, as Claude Code does.
    result = await run(tmp_path, Harness([calls("calculator", expression="1+1"), submits("2")]))

    assert types(result)[:6] == [
        "run_started",
        "step_started",
        "llm_call",
        "tool_call",
        "tool_result",
        "step_finished",
    ]


async def test_tool_names_and_ids_in_the_trace_are_the_arenas_own(tmp_path: Path) -> None:
    result = await run(tmp_path, Harness([calls("calculator", expression="1+1"), submits("2")]))

    serialized = json.dumps(result.events)
    assert "mcp__" not in serialized
    assert "toolu_" not in serialized
    assert [p["tool"] for p in payloads(result, "tool_call")] == ["calculator", "submit_answer"]
    assert [p["call_id"] for p in payloads(result, "tool_call")] == ["call_1", "call_2"]
    assert payloads(result, "llm_call")[0]["output"]["tool_calls"][0] == {
        "call_id": "call_1",
        "tool": "calculator",
        "arguments": {"expression": "1+1"},
    }


async def test_a_plain_text_reply_is_the_answer(tmp_path: Path) -> None:
    harness = Harness([Turn(text="  Forty-two.  ")])

    result = await run(tmp_path, harness)

    assert result.stop_reason == "answered"
    assert result.final_answer == "Forty-two."
    assert harness.model_calls == 1


async def test_submitting_an_answer_ends_the_session_without_another_model_call(
    tmp_path: Path,
) -> None:
    harness = Harness([submits("42"), Turn(text="this response must never be requested")])

    result = await run(tmp_path, harness)

    assert result.final_answer == "42"
    assert harness.model_calls == 1


# --------------------------------------------------------------------------- limits


async def test_stops_at_max_steps_without_an_extra_model_call(tmp_path: Path) -> None:
    harness = Harness([calls("calculator", expression="1+1")], repeat_last=True)

    result = await run(tmp_path, harness, max_steps=3)

    assert result.stop_reason == "max_steps"
    assert result.steps == 3
    assert harness.model_calls == 3
    assert types(result)[-1] == "run_finished"


async def test_stops_at_the_token_limit_and_does_not_run_the_tool(tmp_path: Path) -> None:
    turn = Turn(tools=[("calculator", {"expression": "1+1"})], input_tokens=700, output_tokens=100)
    harness = Harness([turn], repeat_last=True)

    result = await run(tmp_path, harness, limits=RunLimits(max_total_tokens=1500))

    assert result.stop_reason == "max_tokens"
    assert harness.model_calls == 2
    assert result.total_tokens == 1600
    assert len(payloads(result, "tool_call")) == 1
    assert harness.client is not None and harness.client.interrupted


async def test_an_answer_outranks_a_budget_used_up_by_the_same_call(tmp_path: Path) -> None:
    harness = Harness([submits("42", input_tokens=9000, output_tokens=10)])

    result = await run(tmp_path, harness, limits=RunLimits(max_total_tokens=1000))

    assert result.stop_reason == "answered"
    assert result.final_answer == "42"


async def test_tool_output_cap_is_the_shared_one(tmp_path: Path) -> None:
    settings = fakes.make_settings(tmp_path)
    (settings.fixtures_dir / "big.txt").write_text("x" * 5000, encoding="utf-8")
    harness = Harness([calls("read_file", path="big.txt"), submits("ok")])

    result = await run_agent(
        fakes.make_config(backend="agent_sdk", model=MODEL),
        fakes.make_task(),
        llm=None,
        settings=settings,
        limits=RunLimits(tool_output_chars=300),
        pricing=fakes.make_pricing(),
        backend=harness.backend,
    )

    shown = payloads(result, "tool_result")[0]
    assert shown["truncated"] is True
    assert len(shown["output"]) < 340
    # The model was given exactly the text that is in the trace.
    assert harness.client is not None
    assert harness.client.tool_results[0]["content"][0]["text"] == shown["output"]


async def test_a_tool_the_config_does_not_enable_does_not_exist_in_the_session(
    tmp_path: Path,
) -> None:
    harness = Harness([submits("1")])

    await run(tmp_path, harness, enabled_tools=["calculator"])

    assert harness.spec is not None
    assert list(harness.spec.tools) == ["calculator", "submit_answer"]


async def test_a_failed_tool_is_reported_to_the_model_as_an_error(tmp_path: Path) -> None:
    harness = Harness([calls("calculator", expression="__import__('os')"), submits("x")])

    result = await run(tmp_path, harness)

    assert payloads(result, "tool_result")[0]["success"] is False
    assert harness.client is not None
    assert harness.client.tool_results[0]["is_error"] is True
    assert result.stop_reason == "answered"


# ---------------------------------------------------------------- tokens and cost


async def test_prompt_tokens_include_cached_input_and_cost_uses_cache_rates(tmp_path: Path) -> None:
    turn = submits(
        "42",
        input_tokens=1_000,
        cache_read_tokens=6_000,
        cache_write_tokens=3_000,
        output_tokens=1_000,
    )

    result = await run(tmp_path, Harness([turn]))

    call = payloads(result, "llm_call")[0]
    assert call["prompt_tokens"] == 10_000
    assert call["completion_tokens"] == 1_000
    assert call["cache_read_tokens"] == 6_000
    assert call["cache_write_tokens"] == 3_000
    # Subscription: nothing charged. Reference: $2 in, $0.20 read, $2.50 write, $10 out.
    assert call["cost_usd"] == 0.0
    assert call["reference_cost_usd"] == pytest.approx(
        (1_000 * 2 + 6_000 * 0.2 + 3_000 * 2.5 + 1_000 * 10) / 1e6
    )
    assert result.cost_usd == 0.0
    assert result.backend_info["sdk_cost_estimate_usd"] == 0.0123


async def test_output_tokens_come_from_the_final_count_not_the_placeholder(tmp_path: Path) -> None:
    # message_start carries a placeholder (5); message_delta carries the real count.
    result = await run(tmp_path, Harness([submits("42", output_tokens=321)]))

    assert payloads(result, "llm_call")[0]["completion_tokens"] == 321


# ------------------------------------------------- only our prompt and our tools


async def test_the_session_is_asked_for_only_our_prompt_and_tools(tmp_path: Path) -> None:
    harness = Harness([submits("1")])

    await run(
        tmp_path, harness, system_prompt="Solve it.", enabled_tools=["calculator", "read_file"]
    )

    spec, client = harness.spec, harness.client
    assert spec is not None and client is not None
    assert spec.system_prompt == "Solve it."
    assert spec.model == MODEL
    assert client.prompt == fakes.make_task().prompt
    assert list(spec.tools) == ["calculator", "read_file", "submit_answer"]
    assert spec.env["ENABLE_TOOL_SEARCH"] == "false"
    assert set(HARNESS_ENV) <= set(spec.env)
    assert not set(spec.env) & set(FORBIDDEN_VARIABLES)
    assert TOKEN_VARIABLE not in spec.env


async def test_the_real_client_is_built_with_no_built_in_tools_and_no_settings(
    tmp_path: Path,
) -> None:
    harness = Harness([submits("1")])
    await run(tmp_path, harness)
    assert harness.spec is not None

    options = real_client(harness.spec).options  # type: ignore[attr-defined]

    assert options.tools == []
    assert options.setting_sources == []
    assert options.system_prompt == "Solve the task."
    assert sorted(options.allowed_tools) == sorted(
        f"mcp__arena__{name}" for name in harness.spec.tools
    )
    assert list(options.mcp_servers) == ["arena"]
    assert options.include_partial_messages is True
    assert options.permission_mode is None


async def test_the_working_folder_is_removed_after_the_run(tmp_path: Path) -> None:
    harness = Harness([submits("1")])

    await run(tmp_path, harness)

    assert harness.spec is not None
    assert not harness.spec.cwd.exists()


# ------------------------------------------------------- never an API key, never paid


@pytest.mark.parametrize("variable", FORBIDDEN_VARIABLES)
def test_any_api_credential_in_the_environment_is_refused(variable: str) -> None:
    def never(_spec: SessionSpec) -> FakeSdkClient:
        raise AssertionError("no session may be created")

    with pytest.raises(SubscriptionAuthError, match=variable):
        AgentSdkBackend(client_factory=never, env={**SUBSCRIPTION_ENV, variable: "anything"})


def test_a_missing_subscription_token_is_refused_with_no_fallback() -> None:
    with pytest.raises(SubscriptionAuthError, match="no fallback to an API key"):
        check_environment({})
    with pytest.raises(SubscriptionAuthError, match=TOKEN_VARIABLE):
        check_environment({TOKEN_VARIABLE: ""})


def test_selecting_the_backend_without_a_subscription_login_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(TOKEN_VARIABLE, raising=False)
    config = fakes.make_config(backend="agent_sdk", model=MODEL)

    with pytest.raises(SubscriptionAuthError):
        select_backend(config, llm=None)


@pytest.mark.parametrize("source", ["user", "env", "ANTHROPIC_API_KEY", None])
async def test_a_session_that_is_not_on_the_subscription_stops_before_any_model_call(
    tmp_path: Path, source: str | None
) -> None:
    init = {"apiKeySource": source, "tools": ["mcp__arena__calculator"]}
    harness = Harness([submits("1")], init=init)

    with pytest.raises(SubscriptionAuthError, match="API key source"):
        await run(tmp_path, harness, enabled_tools=["calculator"])

    assert harness.model_calls == 0


async def test_a_session_with_a_built_in_tool_stops_before_any_model_call(tmp_path: Path) -> None:
    tools = ["mcp__arena__calculator", "mcp__arena__submit_answer", "Bash"]
    harness = Harness([submits("1")], init={"apiKeySource": "none", "tools": tools})

    with pytest.raises(SubscriptionAuthError, match="built-in tool"):
        await run(tmp_path, harness, enabled_tools=["calculator"])

    assert harness.model_calls == 0


async def test_extra_usage_enabled_on_the_account_is_refused(tmp_path: Path) -> None:
    harness = Harness(
        [calls("calculator", expression="1+1"), submits("2")],
        rate_limit=RateLimitInfo(status="allowed", overage_status="allowed"),
    )

    with pytest.raises(SubscriptionAuthError, match="Extra usage is enabled"):
        await run(tmp_path, harness)

    assert harness.model_calls == 1


async def test_a_usage_limit_abandons_the_run_and_reports_when_it_resets(tmp_path: Path) -> None:
    harness = Harness(
        [calls("calculator", expression="1+1"), submits("2")],
        rate_limit=RateLimitInfo(
            status="rejected", resets_at=1_790_902_800, overage_status="rejected"
        ),
    )

    result = await run(tmp_path, harness)

    assert result.abandoned
    assert result.stop_reason == "error"
    assert result.usage_limit_resets_at == 1_790_902_800
    assert payloads(result, "error")[0]["recoverable"] is True


async def test_normal_usage_status_does_not_interfere(tmp_path: Path) -> None:
    harness = Harness(
        [submits("42")], rate_limit=RateLimitInfo(status="allowed", overage_status="rejected")
    )

    result = await run(tmp_path, harness)

    assert result.stop_reason == "answered"
    assert not result.abandoned


@pytest.mark.parametrize(
    ("error", "abandoned"),
    [("rate_limit", True), ("overloaded", True), ("invalid_request", False)],
)
async def test_api_errors_reported_by_claude_code(
    tmp_path: Path, error: str, abandoned: bool
) -> None:
    result = await run(tmp_path, Harness([submits("1")], assistant_error=error))

    assert result.stop_reason == "error"
    assert result.abandoned is abandoned


async def test_an_authentication_failure_is_a_refusal_not_a_failed_run(tmp_path: Path) -> None:
    harness = Harness([submits("1")], assistant_error="authentication_failed")

    with pytest.raises(SubscriptionAuthError, match="authentication_failed"):
        await run(tmp_path, harness)


# ----------------------------------------------------------------------- secrets


async def test_a_credential_in_tool_output_never_reaches_the_trace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = "sk-ant-oat01-" + "Zx9" * 20
    monkeypatch.setenv(TOKEN_VARIABLE, token)
    settings = fakes.make_settings(tmp_path)
    (settings.fixtures_dir / "leak.txt").write_text(f"token={token}", encoding="utf-8")
    harness = Harness([calls("read_file", path="leak.txt"), submits(f"it is {token}")])

    result = await run_agent(
        fakes.make_config(backend="agent_sdk", model=MODEL),
        fakes.make_task(),
        llm=None,
        settings=settings,
        pricing=fakes.make_pricing(),
        backend=harness.backend,
    )

    serialized = json.dumps(result.events)
    assert token not in serialized
    assert "sk-ant-" not in serialized
    assert "<redacted>" in payloads(result, "tool_result")[0]["output"]


def test_tool_call_request_is_what_the_shared_core_expects() -> None:
    # Guards the seam: the backend hands RunContext the same type the LiteLLM loop does.
    call = ToolCallRequest("id", "calculator", {"expression": "1"}, '{"expression": "1"}')

    assert call.arguments == {"expression": "1"}
