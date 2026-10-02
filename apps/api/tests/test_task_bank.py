"""The 30-task bank: six categories of five.

Tasks with a right answer (code, agent): the scorer accepts known-correct answers
and rejects known-wrong ones, and every expected value is re-derived here.
Open-ended tasks (writing, diagram, explanation, tech stack): the constraint
checks are all met by a known-good answer and not all met by a known-bad one.
"""

import csv
import os
import re
import statistics
from collections import Counter
from pathlib import Path
from typing import Any

import httpx
import pytest

from arena.config import AUTO_SCORED_CATEGORIES, Task, load_bank, load_tasks
from arena.scoring import score_answer
from arena.settings import Settings, get_settings
from arena.tools.read_file import ReadFile
from arena.tools.registry import ALL_TOOL_NAMES

SETTINGS = get_settings()
ALL_TASKS = load_tasks(SETTINGS.tasks_dir)
BANK = load_bank(SETTINGS.tasks_dir)
FIXTURES = SETTINGS.fixtures_dir
CORPUS = SETTINGS.corpus_dir
OPEN_ENDED = sorted(task_id for task_id, task in BANK.items() if task.open_ended)
AUTO_SCORED = sorted(task_id for task_id, task in ALL_TASKS.items() if not task.open_ended)
CODE_TASKS = sorted(task_id for task_id, task in BANK.items() if task.category == "code")


def rows(name: str) -> list[dict[str, str]]:
    with (FIXTURES / name).open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def corpus(name: str) -> str:
    return (CORPUS / f"{name}.md").read_text(encoding="utf-8")


async def sandbox_settings() -> Settings:
    """Settings that point at the real sandbox: code tests and Mermaid parsing run there."""
    url = os.environ.get("ARENA_SANDBOX_URL")
    if not url:
        pytest.skip("ARENA_SANDBOX_URL is not set")
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get(f"{url}/health")
    except httpx.HTTPError:
        pytest.skip("the sandbox is not running")
    return Settings(sandbox_url=url)


def needs_sandbox(task: Task) -> bool:
    if task.scorer_type == "python_check":
        return True
    return any(check["type"] == "mermaid" for check in task.scorer_config.get("checks", []))


async def settings_for(task: Task) -> Settings:
    return await sandbox_settings() if needs_sandbox(task) else SETTINGS


# ------------------------------------------------------------------ the bank itself


def test_the_bank_is_six_categories_of_five() -> None:
    assert len(BANK) == 30
    assert Counter(task.category for task in BANK.values()) == {
        "writing": 5,
        "diagram": 5,
        "explanation": 5,
        "tech_stack": 5,
        "code": 5,
        "agent": 5,
    }


def test_only_code_and_agent_tasks_have_a_right_answer() -> None:
    assert frozenset({"code", "agent"}) == AUTO_SCORED_CATEGORIES
    for task in BANK.values():
        if task.open_ended:
            assert task.scorer_type == "constraints", task.id
        else:
            assert task.scorer_type in {"numeric_tolerance", "exact", "regex", "python_check"}, (
                task.id
            )
    assert Counter(task.scorer_type for task in BANK.values()) == {
        "constraints": 20,
        "python_check": 6,
        "numeric_tolerance": 4,
    }


def test_no_task_uses_the_llm_judge() -> None:
    assert not [task.id for task in ALL_TASKS.values() if task.scorer_type == "llm_judge"]


def test_development_tasks_are_not_in_the_bank() -> None:
    assert {task_id for task_id in ALL_TASKS if task_id not in BANK} == {
        "dev-math-01",
        "dev-csv-01",
        "dev-docs-01",
    }


@pytest.mark.parametrize("task_id", OPEN_ENDED)
def test_every_open_ended_task_states_a_length_limit_and_checks_it(task_id: str) -> None:
    task = BANK[task_id]
    checks = task.scorer_config["checks"]
    limits = [check for check in checks if check["type"] in ("max_words", "max_lines")]

    assert len(limits) == 1, "exactly one length limit"
    # The limit that is checked must be the one the prompt states.
    assert f"at most {limits[0]['value']} " in task.prompt
    assert len(checks) >= 3


def test_every_task_says_how_to_answer_and_names_only_real_tools() -> None:
    for task in BANK.values():
        assert "Answer with" in task.prompt or "Answer in this form" in task.prompt, task.id
        assert set(task.required_tools) <= set(ALL_TOOL_NAMES), task.id
    for task_id in CODE_TASKS:
        assert BANK[task_id].required_tools == ["python_exec"]


def test_the_public_view_of_a_task_hides_answers_hidden_tests_and_checks() -> None:
    for task in ALL_TASKS.values():
        public = task.public()
        assert set(public) == {"id", "title", "category", "difficulty", "prompt", "required_tools"}
    code = BANK["code-01"]
    assert "cases" in code.scorer_config
    assert "cases" not in str(code.public())


# -------------------------------------------- examples: every task, both directions


@pytest.mark.parametrize("task_id", AUTO_SCORED)
async def test_scorer_accepts_known_correct_answers_and_rejects_known_wrong_ones(
    task_id: str,
) -> None:
    task = ALL_TASKS[task_id]
    settings = await settings_for(task)

    for answer in task.examples.correct:
        verdict = await score_answer(task, answer, settings=settings)
        assert verdict.passed is True, (task_id, answer[:60], verdict.explanation)
        assert verdict.score == 1.0
        assert verdict.checks == ()
    for answer in task.examples.wrong:
        verdict = await score_answer(task, answer, settings=settings)
        assert verdict.passed is False, (task_id, answer[:60], verdict.explanation)
        assert verdict.score == 0.0
        assert verdict.explanation


@pytest.mark.parametrize("task_id", OPEN_ENDED)
async def test_constraint_checks_are_all_met_by_a_good_answer_and_not_by_a_bad_one(
    task_id: str,
) -> None:
    task = BANK[task_id]
    settings = await settings_for(task)
    total = len(task.scorer_config["checks"])

    for answer in task.examples.correct:
        verdict = await score_answer(task, answer, settings=settings)
        missed = [(check.name, check.detail) for check in verdict.checks if not check.passed]
        assert not missed, (task_id, missed)
        assert verdict.score == 1.0
        # An open-ended answer is never "passed": there is no right answer.
        assert verdict.passed is None
        assert verdict.explanation == f"Constraints met: {total} of {total}."
    for answer in task.examples.wrong:
        verdict = await score_answer(task, answer, settings=settings)
        assert verdict.passed is None
        assert len(verdict.checks) == total
        assert verdict.constraints_met < total, (task_id, answer[:60])
        assert verdict.score == pytest.approx(verdict.constraints_met / total)
        assert "Not met:" in verdict.explanation


@pytest.mark.parametrize("task_id", sorted(ALL_TASKS))
async def test_an_empty_answer_meets_nothing(task_id: str) -> None:
    task = ALL_TASKS[task_id]
    for answer in (None, "", "   "):
        verdict = await score_answer(task, answer, settings=SETTINGS)
        assert verdict.score == 0.0
        assert verdict.passed is (None if task.open_ended else False)


# ------------------------------------- agent tasks: expected answers, re-derived


def expected(task_id: str) -> Any:  # noqa: ANN401
    return BANK[task_id].scorer_config["expected"]


def test_agent_01_mean_without_the_faulty_reading() -> None:
    readings = [
        float(r["temperature_c"])
        for r in rows("sensor_readings.csv")
        if r["sensor"] == "A" and r["temperature_c"] != ""
    ]
    faulty = [value for value in readings if value > 60]
    kept = [value for value in readings if value <= 60]

    assert len(faulty) == 1
    assert expected("agent-01") == pytest.approx(statistics.mean(kept), abs=0.005)
    # The trap: including the faulty reading gives a clearly different answer.
    assert abs(statistics.mean(readings) - statistics.mean(kept)) > 1


def test_agent_02_top_three_items_by_stock_value() -> None:
    inventory = rows("inventory.csv")
    ranked = sorted(inventory, key=lambda i: int(i["stock"]) * float(i["unit_cost"]), reverse=True)

    assert expected("agent-02") == [item["sku"] for item in ranked[:3]]


def test_agent_03_follows_from_the_corpus() -> None:
    assert "first held in 1923" in corpus("bay-regatta")
    assert "sponsored by the Pinecrest Brewing Cooperative" in corpus("bay-regatta")
    assert "founded in 1994" in corpus("pinecrest-brewing")
    assert expected("agent-03") == 1994 - 1923


async def test_agent_04_counts_errors_in_a_log_too_large_for_read_file() -> None:
    log = (FIXTURES / "server.log").read_text(encoding="utf-8").splitlines()

    assert expected("agent-04") == sum(line.split()[1] == "ERROR" for line in log)
    refused = await ReadFile(FIXTURES).run({"path": "server.log"})
    assert not refused.success
    assert "use python_exec" in str(refused.error)


def test_agent_05_the_notice_overrides_the_corpus() -> None:
    assert "every 30 minutes" in (FIXTURES / "notice.txt").read_text(encoding="utf-8")
    assert "every 40 minutes" in corpus("harbor-ferry")
    assert expected("agent-05") == 30


# --------------------------------- code tasks: the hidden tests themselves are right


def reference_median(values: list[float]) -> float:
    if not values:
        raise ValueError
    return statistics.median(values)


def reference_parse_duration(text: str) -> int:
    if not re.fullmatch(r"(\d+[hms])+", text):
        raise ValueError
    seconds = {"h": 3600, "m": 60, "s": 1}
    return sum(int(number) * seconds[unit] for number, unit in re.findall(r"(\d+)([hms])", text))


def reference_chunk(items: list[Any], size: int) -> list[list[Any]]:
    if size < 1:
        raise ValueError
    return [items[start : start + size] for start in range(0, len(items), size)]


def reference_merge_intervals(intervals: list[list[int]]) -> list[list[int]]:
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def reference_top_words(text: str, k: int) -> list[str]:
    counts = Counter(word.lower() for word in text.split())
    return sorted(counts, key=lambda word: (-counts[word], word))[:k]


REFERENCES: dict[str, Any] = {
    "median": reference_median,
    "parse_duration": reference_parse_duration,
    "chunk": reference_chunk,
    "merge_intervals": reference_merge_intervals,
    "top_words": reference_top_words,
}


@pytest.mark.parametrize("task_id", CODE_TASKS)
def test_every_hidden_test_agrees_with_an_independent_reference(task_id: str) -> None:
    config = BANK[task_id].scorer_config
    reference = REFERENCES[config["function"]]

    assert config["checker"] == "code_tests"
    assert config["crash_is_failure"] is True
    assert len(config["cases"]) >= 8
    for case in config["cases"]:
        if "raises" in case:
            assert case["raises"] == "ValueError"
            with pytest.raises(ValueError):
                reference(*case["args"])
        else:
            assert reference(*case["args"]) == case["expected"], case


async def test_code_that_never_finishes_is_a_failed_answer_not_a_scoring_error() -> None:
    settings = await sandbox_settings()

    verdict = await score_answer(
        BANK["code-02"],
        "def parse_duration(text):\n    while True:\n        pass",
        settings=settings,
    )

    assert verdict.passed is False
    assert verdict.explanation == "The code did not finish within the time limit."


async def test_code_scoring_reports_how_many_hidden_tests_passed() -> None:
    settings = await sandbox_settings()
    buggy = BANK["code-03"].examples.wrong[0]

    verdict = await score_answer(BANK["code-03"], buggy, settings=settings)

    assert verdict.passed is False
    assert re.match(r"\d of 8 hidden tests passed\. First failure: chunk\(", verdict.explanation)


def test_fixtures_are_small_except_the_log() -> None:
    sizes = {path.name: path.stat().st_size for path in Path(FIXTURES).iterdir() if path.is_file()}

    assert set(sizes) == {
        "dev_sales.csv",
        "inventory.csv",
        "notice.txt",
        "sensor_readings.csv",
        "server.log",
    }
    assert sizes["server.log"] > 200_000
    assert all(size < 6_000 for name, size in sizes.items() if name != "server.log")
