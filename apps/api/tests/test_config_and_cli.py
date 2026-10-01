"""Committed configs and tasks, the LiteLLM adapter, and the command line."""

from pathlib import Path
from typing import Any

import pytest
from pydantic import TypeAdapter
from typer.testing import CliRunner

from arena import cli
from arena.config import load_configs, load_tasks
from arena.llm import LiteLLMClient, parse_arguments, response_from_litellm
from arena.schema_gen import ConfigSnapshot
from arena.settings import Settings, get_settings

runner = CliRunner()


def test_committed_configs_form_the_controlled_pairs() -> None:
    configs = load_configs(get_settings().configs_dir)

    def differing_fields(a: str, b: str) -> set[str]:
        left, right = configs[a].snapshot(), configs[b].snapshot()
        ignore = {"id", "family_id", "display_name"}
        return {key for key in left if key not in ignore and left[key] != right[key]}

    assert differing_fields("gemini-full", "gemini-bare-prompt") == {"system_prompt"}
    assert differing_fields("qwen-full", "qwen-two-tools") == {"enabled_tools"}
    assert differing_fields("gemini-full", "qwen-full") == {"model", "provider", "model_family"}
    assert configs["gemini-bare-prompt"].system_prompt == "Answer the question."
    assert differing_fields("claude-sonnet-full", "claude-sonnet-bare-prompt") == {"system_prompt"}
    assert differing_fields("claude-opus-full", "claude-sonnet-full") == {"model"}
    assert differing_fields("claude-sonnet-full", "claude-haiku-full") == {"model"}
    # The Claude and free-tier configs share the same two prompt texts and tool set.
    assert configs["claude-sonnet-full"].system_prompt == configs["gemini-full"].system_prompt
    assert configs["claude-sonnet-bare-prompt"].system_prompt == "Answer the question."
    assert configs["claude-opus-full"].enabled_tools == configs["gemini-full"].enabled_tools
    assert {c.backend for n, c in configs.items() if n.startswith("claude-")} == {"agent_sdk"}
    assert len(configs) == 8
    assert {config.max_steps for config in configs.values()} == {10}
    assert {config.temperature for config in configs.values()} == {None}


def test_config_snapshot_matches_the_trace_schema() -> None:
    adapter = TypeAdapter(ConfigSnapshot)

    for config in load_configs(get_settings().configs_dir).values():
        adapter.validate_python(config.snapshot())


def test_committed_tasks_load_and_only_need_tools_that_exist() -> None:
    tasks = load_tasks(get_settings().tasks_dir)

    assert {"dev-math-01", "dev-csv-01", "dev-docs-01"} <= set(tasks)
    for task in tasks.values():
        assert task.prompt.strip()
        assert task.scorer_config


def test_duplicate_task_ids_are_rejected(tmp_path: Path) -> None:
    body = (
        "id: same\ntitle: t\ncategory: math\ndifficulty: easy\nprompt: p\n"
        "required_tools: []\nscorer_type: exact\nscorer_config: {expected: x}\n"
    )
    (tmp_path / "a.yaml").write_text(body, encoding="utf-8")
    (tmp_path / "b.yaml").write_text(body, encoding="utf-8")

    with pytest.raises(ValueError, match="Duplicate task id"):
        load_tasks(tmp_path)


def test_tool_arguments_must_be_a_json_object() -> None:
    assert parse_arguments('{"a": 1}') == {"a": 1}
    assert parse_arguments("") == {}
    assert parse_arguments("[1, 2]") is None
    assert parse_arguments("{broken") is None


async def test_litellm_response_is_translated_without_a_network_call() -> None:
    import litellm

    # mock_response makes LiteLLM build a response locally instead of calling a provider.
    text = await litellm.acompletion(
        model="groq/openai/gpt-oss-120b",
        messages=[{"role": "user", "content": "hi"}],
        mock_response="hello there",
    )
    tools = await litellm.acompletion(
        model="groq/openai/gpt-oss-120b",
        messages=[{"role": "user", "content": "hi"}],
        mock_tool_calls=[
            {
                "id": "call_9",
                "type": "function",
                "function": {"name": "calculator", "arguments": '{"expression": "1+1"}'},
            }
        ],
    )

    plain = response_from_litellm(text, latency_ms=12)
    called = response_from_litellm(tools, latency_ms=34)

    assert plain.content == "hello there"
    assert plain.tool_calls == []
    assert plain.message["role"] == "assistant"
    assert plain.latency_ms == 12
    assert plain.prompt_tokens >= 0 and plain.completion_tokens >= 0
    assert [(c.call_id, c.name, c.arguments) for c in called.tool_calls] == [
        ("call_9", "calculator", {"expression": "1+1"})
    ]
    assert called.message["tool_calls"][0]["function"]["name"] == "calculator"


async def test_litellm_client_omits_temperature_when_it_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import litellm

    seen: list[dict[str, Any]] = []
    real = litellm.acompletion

    async def capture(**params: Any) -> Any:  # noqa: ANN401
        seen.append(params)
        return await real(**params, mock_response="ok")

    monkeypatch.setattr(litellm, "acompletion", capture)
    client = LiteLLMClient()
    request: dict[str, Any] = {
        "model": "groq/openai/gpt-oss-120b",
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [],
        "max_tokens": 64,
    }

    await client.complete(**request, temperature=None)
    await client.complete(**request, temperature=0.3)

    assert "temperature" not in seen[0]
    assert seen[1]["temperature"] == 0.3
    assert seen[0]["num_retries"] == 0


def test_cli_lists_configs_and_tasks() -> None:
    result = runner.invoke(cli.app, ["list"])

    assert result.exit_code == 0
    assert "gemini-full" in result.output
    assert "qwen-two-tools" in result.output
    assert "dev-math-01" in result.output


def test_cli_reports_an_unknown_config_or_task() -> None:
    unknown_config = runner.invoke(cli.app, ["run", "--config", "nope", "--task", "dev-math-01"])
    unknown_task = runner.invoke(cli.app, ["run", "--config", "gemini-full", "--task", "nope"])

    assert unknown_config.exit_code == 2
    assert "No config named 'nope'" in unknown_config.output
    assert unknown_task.exit_code == 2
    assert "No task with id 'nope'" in unknown_task.output


def test_cli_refuses_a_paid_model_without_calling_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "paid.yaml").write_text(
        "name: paid\nversion: 1\ndisplay_name: Paid\nbackend: litellm\n"
        "model: anthropic/claude-opus-5-5\nprovider: anthropic\nmodel_family: claude\n"
        "system_prompt: x\nenabled_tools: [calculator]\nmax_steps: 3\ntemperature: null\n",
        encoding="utf-8",
    )
    real = get_settings()
    monkeypatch.setattr(
        cli, "get_settings", lambda: Settings(configs_dir=tmp_path, tasks_dir=real.tasks_dir)
    )

    def never(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("a model client must not be built for a refused run")

    monkeypatch.setattr("arena.llm.LiteLLMClient.complete", never)

    result = runner.invoke(cli.app, ["run", "--config", "paid", "--task", "dev-math-01"])

    assert result.exit_code == 3
    assert "Refused" in result.output
    assert "no entry in the pricing table" in result.output


def test_cli_refuses_a_claude_config_without_a_subscription_login() -> None:
    result = runner.invoke(
        cli.app, ["run", "--config", "claude-haiku-full", "--task", "dev-math-01"]
    )

    assert result.exit_code == 3
    assert "Refused" in result.output
    assert "CLAUDE_CODE_OAUTH_TOKEN is not set" in result.output


def test_cli_stops_early_when_the_provider_key_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    def never(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("no model call should be attempted without a key")

    monkeypatch.setattr("arena.llm.LiteLLMClient.complete", never)

    result = runner.invoke(cli.app, ["run", "--config", "gemini-full", "--task", "dev-math-01"])

    assert result.exit_code == 2
    assert "GEMINI_API_KEY is not set" in result.output
