"""The recorder: resumable, stops cleanly, writes nothing unsafe."""

import json
from pathlib import Path
from typing import Any

import pytest

from arena.backends.agent_sdk import _Response
from arena.config import AgentConfig, Task
from arena.recording import (
    UnsafeRecordError,
    build_index,
    ordered,
    read_header,
    record,
    run_path,
    write_run,
)
from arena.runner import RunResult
from tests.fakes import make_config, make_task

CONFIGS = [
    make_config(name="claude-opus-full"),
    make_config(name="claude-haiku-full"),
    make_config(name="claude-sonnet-full"),
]
TASKS = [make_task(id="t-1"), make_task(id="t-2")]


def result(run_id: str, **changes: Any) -> RunResult:  # noqa: ANN401
    fields: dict[str, Any] = {
        "run_id": run_id,
        "stop_reason": "answered",
        "final_answer": "forty two words",
        "steps": 1,
        "tool_calls": 1,
        "prompt_tokens": 100,
        "completion_tokens": 20,
        "cost_usd": 0.0,
        "reference_cost_usd": 0.001,
        "latency_ms": 900,
        "wall_clock_ms": 1200,
        "abandoned": False,
        "events": [{"run_id": run_id, "seq": 0, "type": "step_started", "payload": {"step": 1}}],
        "passed": True,
        "score": 1.0,
    }
    return RunResult(**{**fields, **changes})


class Runs:
    """A scripted run function that remembers what it was asked to run."""

    def __init__(self, overrides: dict[str, list[RunResult]] | None = None) -> None:
        self.calls: list[str] = []
        self.overrides = overrides or {}

    async def __call__(self, config: AgentConfig, task: Task) -> RunResult:
        key = f"{config.name}/{task.id}"
        self.calls.append(key)
        queued = self.overrides.get(key)
        if queued:
            return queued.pop(0)
        return result(f"run-{config.name}-{task.id}")


async def test_haiku_is_recorded_first_and_every_pair_gets_a_file(tmp_path: Path) -> None:
    runs = Runs()

    report = await record(CONFIGS, TASKS, runs, tmp_path)

    assert [config.name for config in ordered(CONFIGS)] == [
        "claude-haiku-full",
        "claude-sonnet-full",
        "claude-opus-full",
    ]
    assert runs.calls[:2] == ["claude-haiku-full/t-1", "claude-haiku-full/t-2"]
    assert report.cause == "done"
    assert len(report.recorded) == 6
    assert len(list((tmp_path / "runs").glob("*.jsonl"))) == 6


async def test_a_second_invocation_runs_only_what_is_missing(tmp_path: Path) -> None:
    await record(CONFIGS[:1], TASKS[:1], Runs(), tmp_path)
    runs = Runs()

    report = await record(CONFIGS[:1], TASKS, runs, tmp_path)

    assert runs.calls == ["claude-opus-full/t-2"]
    assert report.skipped == 1


async def test_a_usage_limit_stops_cleanly_and_writes_nothing_for_that_run(tmp_path: Path) -> None:
    limited = result("x", abandoned=True, usage_limit_resets_at=1_790_000_000, score=None)
    runs = Runs({"claude-haiku-full/t-2": [limited]})

    report = await record(CONFIGS, TASKS, runs, tmp_path)

    assert report.cause == "usage_limit"
    assert report.resets_at == 1_790_000_000
    assert report.recorded == ["claude-haiku-full on t-1"]
    assert report.remaining == 5
    # Not retried: the limit will not lift in twenty seconds.
    assert runs.calls == ["claude-haiku-full/t-1", "claude-haiku-full/t-2"]
    assert not run_path(tmp_path, "claude-haiku-full", "t-2").exists()

    resumed = await record(CONFIGS, TASKS, Runs(), tmp_path)
    assert resumed.cause == "done"
    assert resumed.skipped == 1
    assert len(resumed.recorded) == 5


async def test_a_run_the_provider_could_not_serve_is_retried_then_stops(tmp_path: Path) -> None:
    refused = [result("x", abandoned=True, score=None) for _ in range(3)]
    once = Runs({"claude-haiku-full/t-1": [result("x", abandoned=True, score=None)]})
    always = Runs({"claude-haiku-full/t-1": refused})

    recovered = await record(CONFIGS[1:2], TASKS[:1], once, tmp_path / "a", retry_delay_s=0)
    stopped = await record(CONFIGS[1:2], TASKS[:1], always, tmp_path / "b", retry_delay_s=0)

    assert recovered.cause == "done"
    assert len(once.calls) == 2
    assert stopped.cause == "provider_unavailable"
    assert len(always.calls) == 3
    assert not (tmp_path / "b" / "runs").exists()


async def test_a_run_that_could_not_be_scored_is_not_recorded(tmp_path: Path) -> None:
    runs = Runs({"claude-haiku-full/t-1": [result("x", passed=None, score=None)]})

    report = await record(CONFIGS[1:2], TASKS, runs, tmp_path)

    assert report.cause == "unscored"
    assert report.recorded == []


async def test_a_failed_answer_is_a_result_and_is_recorded(tmp_path: Path) -> None:
    wrong = result("w", passed=False, score=0.0, stop_reason="max_steps", final_answer=None)

    report = await record(
        CONFIGS[1:2], TASKS[:1], Runs({"claude-haiku-full/t-1": [wrong]}), tmp_path
    )

    assert report.cause == "done"
    header = read_header(run_path(tmp_path, "claude-haiku-full", "t-1"))
    assert header["passed"] is False
    assert header["stop_reason"] == "max_steps"
    assert header["answer_words"] == 0


async def test_the_run_file_is_a_header_then_the_events(tmp_path: Path) -> None:
    checks = [
        {"name": "a", "passed": True, "detail": ""},
        {"name": "b", "passed": False, "detail": ""},
    ]
    scored = result("r1", passed=None, score=0.5, checks=checks)
    await record(CONFIGS[1:2], TASKS[:1], Runs({"claude-haiku-full/t-1": [scored]}), tmp_path)

    lines = run_path(tmp_path, "claude-haiku-full", "t-1").read_text(encoding="utf-8").splitlines()
    header = json.loads(lines[0])

    assert header["record"] == "run"
    assert header["config_id"] == "claude-haiku-full@v1"
    assert (header["checks_met"], header["checks_total"]) == (1, 2)
    assert header["answer_words"] == 3
    assert header["total_tokens"] == 120
    assert [json.loads(line)["type"] for line in lines[1:]] == ["step_started"]


def test_a_record_that_still_holds_a_credential_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = "sk-ant-" + "oat01-" + "a" * 40
    # With scrubbing switched off, the last check must still catch it.
    monkeypatch.setattr("arena.recording.scrub", lambda value: value)

    with pytest.raises(UnsafeRecordError, match="Anthropic key"):
        write_run(tmp_path / "runs" / "x.jsonl", {"record": "run", "note": token}, [])

    assert not (tmp_path / "runs" / "x.jsonl").exists()


def test_credentials_are_scrubbed_from_what_is_written(tmp_path: Path) -> None:
    token = "sk-ant-" + "oat01-" + "b" * 40
    path = tmp_path / "runs" / "x.jsonl"

    write_run(path, {"record": "run"}, [{"payload": {"output": f"leaked {token}"}}])

    assert token not in path.read_text(encoding="utf-8")


async def test_the_index_pairs_every_two_configs_on_every_task(tmp_path: Path) -> None:
    await record(CONFIGS, TASKS, Runs(), tmp_path)

    runs, matches = build_index(tmp_path, TASKS)
    listed = json.loads((tmp_path / "matches.json").read_text(encoding="utf-8"))
    index = json.loads((tmp_path / "runs-index.json").read_text(encoding="utf-8"))
    tasks = json.loads((tmp_path / "tasks.json").read_text(encoding="utf-8"))

    assert (runs, matches) == (6, 6)
    assert len({match["id"] for match in listed}) == 6
    by_run = {row["run_id"]: row for row in index}
    for match in listed:
        left, right = by_run[match["left_run_id"]], by_run[match["right_run_id"]]
        assert left["task_id"] == right["task_id"] == match["task_id"]
        assert left["config_name"] != right["config_name"]
        # A match id must not name the configs it compares.
        assert "claude" not in match["id"]
    assert all("scorer_config" not in task and "examples" not in task for task in tasks)
    # Rebuilding gives the same matches and the same sides.
    build_index(tmp_path, TASKS)
    assert json.loads((tmp_path / "matches.json").read_text(encoding="utf-8")) == listed


async def test_a_partial_recording_only_makes_matches_that_have_both_runs(tmp_path: Path) -> None:
    await record(CONFIGS[:2], TASKS[:1], Runs(), tmp_path)
    await record(CONFIGS[2:], TASKS, Runs(), tmp_path)

    _runs, matches = build_index(tmp_path, TASKS)

    assert matches == 3


def test_thinking_is_kept_apart_from_the_reply() -> None:
    response = _Response({"input_tokens": 10}, requested_at=0.0)
    response.start_block(0, {"type": "thinking", "thinking": ""})
    response.add_delta(0, {"type": "thinking_delta", "thinking": "Compare the two "})
    response.add_delta(0, {"type": "thinking_delta", "thinking": "totals."})
    response.start_block(1, {"type": "text"})
    response.add_delta(1, {"type": "text_delta", "text": "The answer is 4."})
    silent = _Response({"input_tokens": 10}, requested_at=0.0)
    silent.add_delta(0, {"type": "text_delta", "text": "4"})

    assert response.to_llm_response(5).thinking == "Compare the two totals."
    assert response.to_llm_response(5).content == "The answer is 4."
    assert silent.to_llm_response(5).thinking is None
