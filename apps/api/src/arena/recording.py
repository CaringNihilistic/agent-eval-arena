"""Records the task bank for each config into `data/recordings/`, resumably.

The folder is the store: one JSONL file per run, plus two index files the web
app reads. A (config, task, take) is done when its file exists, so running the
command again continues where the last one stopped. A second take of the same
config on the same task is what an impostor round shows in two seats.
"""

import asyncio
import json
import os
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from arena.config import AgentConfig, Task
from arena.events import Event
from arena.runner import RunResult
from arena.scrub import SECRET_PATTERNS, scrub

# Cheapest model first, so a usage limit costs the least-recorded config the least.
RECORD_ORDER = ("claude-haiku-full", "claude-sonnet-full", "claude-opus-full")
# A run the provider could not serve is tried again this many times before stopping.
RETRIES = 2
RETRY_DELAY_S = 20.0

RunOne = Callable[[AgentConfig, Task], Awaitable[RunResult]]
StopCause = Literal["done", "usage_limit", "provider_unavailable", "unscored"]


class UnsafeRecordError(Exception):
    """A record still looked like it held a credential after scrubbing."""


@dataclass
class RecordReport:
    cause: StopCause = "done"
    recorded: list[str] = field(default_factory=list)
    skipped: int = 0
    remaining: int = 0
    # Unix seconds at which the subscription's usage limit resets, if that stopped us.
    resets_at: int | None = None
    detail: str | None = None


def run_path(out_dir: Path, config_name: str, task_id: str, take: int = 1) -> Path:
    suffix = "" if take == 1 else f"__{take}"
    return out_dir / "runs" / f"{config_name}__{task_id}{suffix}.jsonl"


def run_header(config: AgentConfig, task: Task, result: RunResult, take: int = 1) -> dict[str, Any]:
    """Everything about a run that the leaderboards need, without reading its events."""
    return {
        "record": "run",
        "run_id": result.run_id,
        "config_id": config.id,
        "config_name": config.name,
        "display_name": config.display_name,
        "model": config.model,
        "task_id": task.id,
        "take": take,
        "category": task.category,
        "stop_reason": result.stop_reason,
        "passed": result.passed,
        "score": result.score,
        "scorer_type": task.scorer_type,
        "checks_met": sum(1 for check in result.checks if check["passed"]),
        "checks_total": len(result.checks),
        "answer_words": result.answer_words,
        "steps": result.steps,
        "tool_calls": result.tool_calls,
        "prompt_tokens": result.prompt_tokens,
        "completion_tokens": result.completion_tokens,
        "total_tokens": result.total_tokens,
        "cost_usd": result.cost_usd,
        "reference_cost_usd": result.reference_cost_usd,
        "latency_ms": result.latency_ms,
        "wall_clock_ms": result.wall_clock_ms,
        "harness_version": result.backend_info.get("harness_version"),
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(text, encoding="utf-8", newline="\n")
    os.replace(partial, path)


def write_run(path: Path, header: dict[str, Any], events: Sequence[Event]) -> None:
    """Write one run: the header line, then one event per line. Scrubbed, and
    refused if anything credential-shaped is still there."""
    lines = [json.dumps(scrub(item), ensure_ascii=False) for item in (header, *events)]
    text = "\n".join(lines) + "\n"
    for name, pattern in SECRET_PATTERNS.items():
        if pattern.search(text):
            raise UnsafeRecordError(f"{path.name} still contains something shaped like a {name}.")
    _atomic_write(path, text)


def read_header(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        header: dict[str, Any] = json.loads(handle.readline())
    if header.get("record") != "run":
        raise ValueError(f"{path} does not start with a run header")
    return header


def build_index(out_dir: Path, tasks: Sequence[Task]) -> int:
    """Rewrite the index files from the run files. Returns the number of runs."""
    headers = []
    for path in sorted((out_dir / "runs").glob("*.jsonl")):
        header = read_header(path)
        # Runs recorded before takes existed are first takes.
        headers.append({**header, "take": header.get("take", 1), "file": f"runs/{path.name}"})
    public_tasks = [task.public() for task in tasks]

    def dump(name: str, value: object) -> None:
        _atomic_write(out_dir / name, json.dumps(value, indent=2, ensure_ascii=False) + "\n")

    dump("runs-index.json", headers)
    dump("tasks.json", public_tasks)
    return len(headers)


def ordered(configs: Sequence[AgentConfig]) -> list[AgentConfig]:
    rank = {name: index for index, name in enumerate(RECORD_ORDER)}
    return sorted(configs, key=lambda config: (rank.get(config.name, len(rank)), config.name))


async def record(
    configs: Sequence[AgentConfig],
    tasks: Sequence[Task],
    run_one: RunOne,
    out_dir: Path,
    *,
    take: int = 1,
    on_run: Callable[[AgentConfig, Task, RunResult], None] | None = None,
    retry_delay_s: float = RETRY_DELAY_S,
) -> RecordReport:
    """Record every missing (config, task) pair of this take, one run at a time."""
    report = RecordReport()
    pairs = [(config, task) for config in ordered(configs) for task in tasks]
    for index, (config, task) in enumerate(pairs):
        path = run_path(out_dir, config.name, task.id, take)
        if path.exists():
            report.skipped += 1
            continue
        result = await run_one(config, task)
        attempts = 0
        while result.abandoned and result.usage_limit_resets_at is None and attempts < RETRIES:
            attempts += 1
            await asyncio.sleep(retry_delay_s)
            result = await run_one(config, task)
        if on_run is not None:
            on_run(config, task, result)

        stop: StopCause | None = None
        if result.abandoned:
            limited = result.usage_limit_resets_at is not None
            stop = "usage_limit" if limited else "provider_unavailable"
            report.resets_at = result.usage_limit_resets_at
        elif result.score is None:
            # The scorer could not run (the sandbox is down, say). Not the agent's
            # doing, and an unscored run is useless to the leaderboards.
            stop = "unscored"
        if stop is not None:
            report.cause = stop
            report.detail = f"{config.name} on {task.id}"
            report.remaining = sum(
                1 for c, t in pairs[index:] if not run_path(out_dir, c.name, t.id, take).exists()
            )
            return report

        write_run(path, run_header(config, task, result, take), result.events)
        report.recorded.append(f"{config.name} on {task.id}")
    return report
