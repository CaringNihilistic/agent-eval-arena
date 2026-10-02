"""Runs one config across many tasks and summarises the results."""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from arena.config import Task
from arena.runner import RunResult

RunOne = Callable[[Task], Awaitable[RunResult]]


@dataclass(frozen=True)
class EvalRow:
    task: Task
    result: RunResult

    @property
    def outcome(self) -> str:
        if self.result.abandoned:
            return "not run"
        if self.result.checks:
            met = sum(check["passed"] for check in self.result.checks)
            return f"{met}/{len(self.result.checks)}"
        if self.result.passed is None:
            return "unscored"
        return "pass" if self.result.passed else "fail"


async def evaluate(
    tasks: Sequence[Task],
    run_one: RunOne,
    *,
    delay_s: float = 0.0,
    on_row: Callable[[EvalRow], None] | None = None,
) -> list[EvalRow]:
    """Run the tasks one at a time. Free tiers do not tolerate parallel runs."""
    rows = []
    for index, task in enumerate(tasks):
        if index and delay_s > 0:
            await asyncio.sleep(delay_s)
        row = EvalRow(task, await run_one(task))
        rows.append(row)
        if on_row is not None:
            on_row(row)
    return rows


HEADER = (
    f"{'task':<10} {'category':<14} {'result':<8} {'steps':>5} {'tokens':>7} "
    f"{'active s':>8} {'stop':<10} answer"
)


def format_row(row: EvalRow) -> str:
    result = row.result
    answer = " ".join((result.final_answer or "").split())
    if len(answer) > 40:
        answer = answer[:39] + "…"
    return (
        f"{row.task.id:<10} {row.task.category:<14} {row.outcome:<8} {result.steps:>5} "
        f"{result.total_tokens:>7} {result.latency_ms / 1000:>8.1f} {result.stop_reason:<10} "
        f"{answer}"
    )


def summarise(rows: Sequence[EvalRow]) -> list[str]:
    """Totals overall and per category. Runs the provider refused are not counted
    as failures: they were never run."""
    lines = []
    scored = [row for row in rows if row.outcome in ("pass", "fail")]
    not_run = sum(row.outcome == "not run" for row in rows)
    unscored = sum(row.outcome == "unscored" for row in rows)
    passed = sum(row.outcome == "pass" for row in scored)
    rate = f"{100 * passed / len(scored):.0f}%" if scored else "n/a"
    lines.append(f"passed {passed} of {len(scored)} runs with a right answer ({rate})")
    open_ended = [row for row in rows if row.result.checks]
    if open_ended:
        met = sum(c["passed"] for row in open_ended for c in row.result.checks)
        total = sum(len(row.result.checks) for row in open_ended)
        lines.append(
            f"open-ended runs: {len(open_ended)}, constraints met {met} of {total} "
            "(limits respected, not quality)"
        )
    for category in sorted({row.task.category for row in scored}):
        group = [row for row in scored if row.task.category == category]
        lines.append(f"  {category:<14} {sum(r.outcome == 'pass' for r in group)} of {len(group)}")
    if not_run:
        lines.append(f"not run (provider refused or rate-limited): {not_run}")
    if unscored:
        lines.append(f"ran but could not be scored: {unscored}")
    tokens = sum(row.result.total_tokens for row in rows)
    reference = sum(row.result.reference_cost_usd for row in rows)
    actual = sum(row.result.cost_usd for row in rows)
    lines.append(f"tokens {tokens}, actual cost ${actual:.4f}, at paid rates ${reference:.4f}")
    return lines
