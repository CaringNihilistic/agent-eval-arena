"""The 30-task bank: every task's scorer accepts a known-correct answer and rejects
a known-wrong one, and every expected answer is re-derived here from the fixtures,
the corpus, or the arithmetic, independently of the task file."""

import csv
import math
import os
import statistics
from collections import Counter, defaultdict
from datetime import date
from itertools import pairwise
from pathlib import Path

import httpx
import pytest

from arena.config import Task, load_bank, load_tasks
from arena.scoring import score_answer
from arena.settings import Settings, get_settings
from arena.tools.read_file import ReadFile
from arena.tools.registry import ALL_TOOL_NAMES
from arena.tools.search_docs import SearchDocs

SETTINGS = get_settings()
ALL_TASKS = load_tasks(SETTINGS.tasks_dir)
BANK = load_bank(SETTINGS.tasks_dir)
FIXTURES = SETTINGS.fixtures_dir
CORPUS = SETTINGS.corpus_dir


def rows(name: str) -> list[dict[str, str]]:
    with (FIXTURES / name).open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def corpus(name: str) -> str:
    return (CORPUS / f"{name}.md").read_text(encoding="utf-8")


def expected(task_id: str) -> object:
    return BANK[task_id].scorer_config["expected"]


async def sandbox_settings() -> Settings:
    """Settings that point at the real sandbox, for the one python_check task."""
    url = os.environ.get("ARENA_SANDBOX_URL")
    if not url:
        pytest.skip("ARENA_SANDBOX_URL is not set")
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get(f"{url}/health")
    except httpx.HTTPError:
        pytest.skip("the sandbox is not running")
    return Settings(sandbox_url=url)


async def settings_for(task: Task) -> Settings:
    return await sandbox_settings() if task.scorer_type == "python_check" else SETTINGS


# ------------------------------------------------------------------ the bank itself


def test_the_bank_has_thirty_tasks_in_the_planned_mix() -> None:
    assert len(BANK) == 30
    assert Counter(task.category for task in BANK.values()) == {
        "math": 8,
        "data_analysis": 8,
        "multi_hop": 8,
        "tool_trap": 6,
    }
    assert {task.difficulty for task in BANK.values()} == {"easy", "medium", "hard"}


def test_development_tasks_are_not_in_the_bank() -> None:
    assert {task_id for task_id in ALL_TASKS if task_id.startswith("dev-")} == {
        "dev-math-01",
        "dev-csv-01",
        "dev-docs-01",
    }
    assert not any(task_id.startswith("dev-") for task_id in BANK)


def test_no_bank_task_uses_the_llm_judge() -> None:
    assert Counter(task.scorer_type for task in BANK.values()) == {
        "numeric_tolerance": 25,
        "exact": 3,
        "regex": 1,
        "python_check": 1,
    }


def test_every_task_names_only_real_tools_and_says_how_to_answer() -> None:
    for task in ALL_TASKS.values():
        assert task.required_tools, task.id
        assert set(task.required_tools) <= set(ALL_TOOL_NAMES), task.id
    for task in BANK.values():
        assert "Answer with" in task.prompt, task.id


def test_the_public_view_of_a_task_hides_the_answer() -> None:
    for task in ALL_TASKS.values():
        public = task.public()
        assert set(public) == {"id", "title", "category", "difficulty", "prompt", "required_tools"}
        assert "scorer_config" not in public and "examples" not in public


@pytest.mark.parametrize("task_id", sorted(ALL_TASKS))
async def test_scorer_accepts_known_correct_answers_and_rejects_known_wrong_ones(
    task_id: str,
) -> None:
    task = ALL_TASKS[task_id]
    settings = await settings_for(task)

    for answer in task.examples.correct:
        verdict = await score_answer(task, answer, settings=settings)
        assert verdict.passed, (task_id, answer, verdict.explanation)
        assert verdict.score == 1.0
    for answer in task.examples.wrong:
        verdict = await score_answer(task, answer, settings=settings)
        assert not verdict.passed, (task_id, answer, verdict.explanation)
        assert verdict.score == 0.0
        assert verdict.explanation


@pytest.mark.parametrize("task_id", sorted(ALL_TASKS))
async def test_an_empty_answer_never_passes(task_id: str) -> None:
    for answer in (None, "", "   "):
        verdict = await score_answer(ALL_TASKS[task_id], answer, settings=SETTINGS)
        assert not verdict.passed


# -------------------------------------- expected answers, re-derived independently


def test_math_answers() -> None:
    assert expected("math-01") == pytest.approx(500 * 0.12 + 1340 * 0.09 + 7.50, abs=0.005)
    assert expected("math-02") == pytest.approx(4200 * (1 + 0.036 / 12) ** 30, abs=0.005)
    assert expected("math-03") == pytest.approx((18 + 27) / (18 / 24 + 27 / 18), abs=0.005)
    assert expected("math-04") == pytest.approx(260 * 1.15 * 0.80 * 1.085, abs=0.005)
    # 0.12x + 0.40 * 30 = 0.25 (x + 30)
    assert expected("math-05") == pytest.approx((0.40 * 30 - 0.25 * 30) / (0.25 - 0.12), abs=0.005)
    assert expected("math-06") == pytest.approx(1 / (1 / 6 + 1 / 9 - 1 / 12), abs=0.005)
    assert expected("math-07") == pytest.approx(math.pi * 1.4**2 * 3.2 * 0.65 * 1000, abs=0.5)
    assert expected("math-08") == pytest.approx((80 - 0.2 * 88 - 0.3 * 74) / 0.5, abs=0.05)


def test_order_answers_come_from_the_orders_file() -> None:
    orders = rows("orders.csv")
    completed = [o for o in orders if o["status"] == "completed"]
    revenue_by_region: dict[str, float] = defaultdict(float)
    for order in completed:
        revenue_by_region[order["region"]] += int(order["quantity"]) * float(order["unit_price"])

    assert expected("data-01") == pytest.approx(sum(revenue_by_region.values()), abs=0.005)
    ranked = sorted(revenue_by_region.items(), key=lambda pair: pair[1], reverse=True)
    assert expected("data-02") == ranked[0][0]
    assert ranked[0][1] - ranked[1][1] > 100, "the top region must not be a near tie"
    months = Counter(order["order_date"][:7] for order in orders).most_common()
    assert expected("data-05") == months[0][0]
    assert months[0][1] > months[1][1], "the busiest month must be unique"


def test_employee_and_inventory_answers_come_from_their_files() -> None:
    engineering = [
        int(e["salary"]) for e in rows("employees.csv") if e["department"] == "Engineering"
    ]
    assert expected("data-03") == statistics.median(engineering)

    inventory = rows("inventory.csv")
    assert expected("data-04") == sum(int(i["stock"]) < int(i["reorder_point"]) for i in inventory)
    by_value = sorted(
        inventory, key=lambda i: int(i["stock"]) * float(i["unit_cost"]), reverse=True
    )
    assert expected("data-08") == [item["sku"] for item in by_value[:3]]
    values = [int(i["stock"]) * float(i["unit_cost"]) for i in by_value[:4]]
    assert min(a - b for a, b in pairwise(values)) > 1, "no near ties"


def test_sensor_answers_come_from_the_readings_file() -> None:
    readings = rows("sensor_readings.csv")

    def temperatures(sensor: str) -> list[float]:
        return [
            float(r["temperature_c"])
            for r in readings
            if r["sensor"] == sensor and r["temperature_c"] != ""
        ]

    assert any(r["temperature_c"] == "" for r in readings if r["sensor"] == "B")
    assert expected("data-06") == pytest.approx(statistics.mean(temperatures("B")), abs=0.005)
    faulty = [t for t in temperatures("A") if t > 60]
    assert len(faulty) == 1
    kept = [t for t in temperatures("A") if t <= 60]
    assert expected("data-07") == pytest.approx(statistics.mean(kept), abs=0.005)
    # The trap in data-07: including the faulty reading gives a different answer.
    assert abs(statistics.mean(temperatures("A")) - statistics.mean(kept)) > 1


def test_multi_hop_answers_follow_from_the_corpus() -> None:
    transit, ferry = corpus("tidewater-transit"), corpus("harbor-ferry")
    assert "led by director Imani Okafor since 2021" in transit
    assert "held the post for nine years" in transit
    assert expected("hop-01") == 2021 - 9

    assert "operated by the Tidewater Transit Authority" in ferry
    assert "headquarters are in Saltmarsh Landing" in transit
    assert "population of 31,250" in corpus("saltmarsh-landing")
    assert expected("hop-02") == 31250

    assert "The Maritime Museum is in Saltmarsh Landing" in corpus("maritime-museum")
    assert "mayor of Saltmarsh Landing is Helena Voss" in corpus("saltmarsh-landing")
    assert expected("hop-03") == "Helena Voss"

    assert "original lens of Kestrel Point Lighthouse" in corpus("maritime-museum")
    assert "built in 1892" in corpus("kestrel-point-lighthouse")
    assert expected("hop-04") == 1892

    assert "MV Kestrel, entered service in 2019 and carries 310 passengers" in ferry
    assert "MV Heron and the MV Osprey each carry 240 passengers" in ferry
    assert expected("hop-05") == 310 + 240 + 240

    assert "first held in 1923" in corpus("bay-regatta")
    assert "sponsored by the Pinecrest Brewing Cooperative" in corpus("bay-regatta")
    assert "founded in 1994" in corpus("pinecrest-brewing")
    assert expected("hop-06") == 1994 - 1923

    assert "It opened in 1954" in corpus("ridge-line")
    assert "upper station of the Ridge Line funicular" in corpus("lookout-ridge")
    assert "It opened in 1968" in corpus("lookout-ridge")
    assert expected("hop-07") == 1968 - 1954

    assert "Its best-known beer is Kestrel Amber" in corpus("pinecrest-brewing")


def test_trap_answers() -> None:
    assert expected("trap-01") == (date(2026, 11, 3) - date(2026, 1, 15)).days

    previous, current = 1, 1
    for _ in range(28):
        previous, current = current, previous + current
    assert expected("trap-02") == current

    log = (FIXTURES / "server.log").read_text(encoding="utf-8").splitlines()
    assert expected("trap-03") == sum(line.split()[1] == "ERROR" for line in log)

    assert "The tower is 34 metres tall" in corpus("kestrel-point-lighthouse")
    assert expected("trap-04") == 34

    assert "every 30 minutes" in (FIXTURES / "notice.txt").read_text(encoding="utf-8")
    assert expected("trap-05") == 30

    assert "The track is 612 metres long" in corpus("ridge-line")
    assert expected("trap-06") == round(612 * 3.28084)


# ------------------------------------------------- the traps really are traps


async def test_trap_03_the_log_is_too_large_for_read_file() -> None:
    result = await ReadFile(FIXTURES).run({"path": "server.log"})

    assert not result.success
    assert "use python_exec" in str(result.error)


async def test_trap_04_a_search_for_kestrel_returns_the_ferry_as_well_as_the_lighthouse() -> None:
    result = await SearchDocs(CORPUS).run({"query": "Kestrel"})

    assert "[harbor-ferry]" in result.output or "[pinecrest-brewing]" in result.output
    lighthouse = await SearchDocs(CORPUS).run(
        {"query": "Kestrel Point lighthouse height metres tall"}
    )
    assert "34 metres tall" in lighthouse.output


def test_trap_05_the_corpus_still_gives_the_old_interval() -> None:
    assert "every 40 minutes" in corpus("harbor-ferry")


async def test_every_multi_hop_fact_can_be_found_by_search() -> None:
    search = SearchDocs(CORPUS)
    queries = {
        "Harbor Ferry operator": "Tidewater Transit Authority",
        "Tidewater Transit Authority director": "Imani Okafor",
        "Tidewater Transit Authority headquarters": "Saltmarsh Landing",
        "Saltmarsh Landing population": "31,250",
        "Maritime Museum lens lighthouse": "Kestrel Point Lighthouse",
        "Bay Regatta sponsor": "Pinecrest Brewing Cooperative",
        "Pinecrest Brewing Cooperative founded": "1994",
        "Ridge Observatory opened": "1968",
        "Harbor Ferry fleet vessels passengers": "310 passengers",
    }
    for query, fact in queries.items():
        assert fact in (await search.run({"query": query})).output, query


def test_fixtures_are_small_enough_for_the_tool_output_cap_except_the_log() -> None:
    sizes = {path.name: path.stat().st_size for path in Path(FIXTURES).iterdir() if path.is_file()}

    assert sizes["server.log"] > 200_000
    for name, size in sizes.items():
        if name != "server.log":
            assert size < 6_000, name
