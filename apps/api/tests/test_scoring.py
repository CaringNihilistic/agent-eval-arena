"""Each scorer on its own, the judge's rules, scoring inside a run, and the eval table."""

from pathlib import Path
from typing import Any

import httpx
import pytest

from arena.evaluation import EvalRow, evaluate, format_row, summarise
from arena.llm import LLMCallError
from arena.runner import RunResult, run_agent
from arena.scoring import (
    ScoringError,
    checker_script,
    normalize,
    numbers_in,
    score_answer,
    score_python_check,
)
from arena.settings import Settings, get_settings
from tests import fakes
from tests.fakes import ScriptedLLM, asks_for, says, submits, tool_call

SETTINGS = get_settings()


def task(scorer_type: str, **config: Any) -> Any:  # noqa: ANN401
    return fakes.make_task(scorer_type=scorer_type, scorer_config=config)


# ------------------------------------------------------------------ normalisation


@pytest.mark.parametrize(
    ("raw", "cleaned"),
    [
        ("  South. ", "south"),
        ('"Helena Voss"', "helena voss"),
        ("Helena   Voss!", "helena voss"),
        ("`2026-05`", "2026-05"),
        ("“east”", "east"),
    ],
)
def test_normalize(raw: str, cleaned: str) -> None:
    assert normalize(raw) == cleaned


@pytest.mark.parametrize(
    ("text", "numbers"),
    [
        ("313.03", [313.03]),
        ("$4,594.91", [4594.91]),
        ("12,808 litres", [12808.0]),
        ("about -5.5 degrees", [-5.5]),
        ("In 2012", [2012.0]),
        (".5", [0.5]),
        ("313.03 (340.25 before the discount)", [313.03, 340.25]),
        ("no number here", []),
    ],
)
def test_numbers_in(text: str, numbers: list[float]) -> None:
    assert numbers_in(text) == numbers


# ---------------------------------------------------------------------- scorers


async def test_exact_scorer_ignores_case_spacing_and_a_full_stop() -> None:
    exact = task("exact", expected="Helena Voss", also_accept=["Mayor Voss"])

    assert (await score_answer(exact, " helena  voss. ", settings=SETTINGS)).passed
    assert (await score_answer(exact, "Mayor Voss", settings=SETTINGS)).passed
    wrong = await score_answer(exact, "The mayor is Helena Voss", settings=SETTINGS)
    assert not wrong.passed
    assert "Helena Voss" in wrong.explanation


async def test_numeric_scorer_respects_the_tolerance() -> None:
    numeric = task("numeric_tolerance", expected=188.10, tolerance=0.01)

    assert (await score_answer(numeric, "188.1", settings=SETTINGS)).passed
    assert (await score_answer(numeric, "$188.11", settings=SETTINGS)).passed
    assert not (await score_answer(numeric, "188.12", settings=SETTINGS)).passed
    assert not (await score_answer(numeric, "188", settings=SETTINGS)).passed


async def test_numeric_scorer_refuses_to_pick_between_several_numbers() -> None:
    numeric = task("numeric_tolerance", expected=313.03, tolerance=0.01)

    verdict = await score_answer(numeric, "313.03 (340.25 before the discount)", settings=SETTINGS)

    assert not verdict.passed
    assert "several numbers" in verdict.explanation
    # The same number written twice is still one answer.
    assert (await score_answer(numeric, "313.03, that is 313.03", settings=SETTINGS)).passed


async def test_numeric_scorer_with_no_number() -> None:
    verdict = await score_answer(
        task("numeric_tolerance", expected=5, tolerance=0), "five", settings=SETTINGS
    )

    assert not verdict.passed
    assert "No number" in verdict.explanation


async def test_regex_scorer_must_match_the_whole_answer() -> None:
    regex = task("regex", pattern="(the )?kestrel amber( ale)?", case_insensitive=True)

    assert (await score_answer(regex, "Kestrel Amber Ale.", settings=SETTINGS)).passed
    assert not (
        await score_answer(regex, "Kestrel Amber or Saltmarsh Stout", settings=SETTINGS)
    ).passed


# ----------------------------------------------------------------- python_check


def sandbox_returning(**body: object) -> httpx.AsyncClient:
    reply = {"stdout": "", "stderr": "", "exit_code": 0, "timed_out": False, **body}
    return httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=reply))
    )


def check_task() -> Any:  # noqa: ANN401
    return task(
        "python_check", checker="top_three_skus", expected=["SKU-001", "SKU-002", "SKU-003"]
    )


def test_the_checker_script_embeds_the_answer_safely() -> None:
    hostile = "\"\"\"\nimport os; os.system('id')\n'''"

    script = checker_script("def check(answer, config):\n    return True, answer", hostile, {})

    # The answer travels as a JSON string literal, so none of it runs as code.
    compile(script, "check.py", "exec")
    namespace: dict[str, Any] = {}
    exec(script, namespace)
    assert namespace["_answer"] == hostile


def test_the_real_checker_judges_order_and_membership() -> None:
    source = (SETTINGS.tasks_dir / "checkers" / "top_three_skus.py").read_text(encoding="utf-8")
    namespace: dict[str, Any] = {}
    exec(source, namespace)
    check = namespace["check"]
    config = {"expected": ["SKU-022", "SKU-024", "SKU-014"]}

    assert check("sku-022, SKU-024,SKU-014.", config)[0] is True
    assert check("SKU-024, SKU-022, SKU-014", config) == (
        False,
        "The right SKUs, but not in order of stock value.",
    )
    assert check("SKU-022, SKU-024", config)[0] is False
    assert check("SKU-022, SKU-024, SKU-099", config)[0] is False


async def test_python_check_reads_the_verdict_the_sandbox_prints() -> None:
    settings = Settings(sandbox_url="http://sandbox")
    passed = sandbox_returning(stdout='{"passed": true, "explanation": "The SKUs match."}\n')
    failed = sandbox_returning(stdout='{"passed": false, "explanation": "Not in order."}\n')

    assert (await score_python_check(check_task(), "x", settings, passed)).passed
    verdict = await score_python_check(check_task(), "x", settings, failed)
    assert not verdict.passed
    assert verdict.explanation == "Not in order."


async def test_a_broken_checker_or_sandbox_is_a_scoring_error_not_a_wrong_answer() -> None:
    settings = Settings(sandbox_url="http://sandbox")
    crashed = sandbox_returning(exit_code=1, stderr="NameError: boom")
    silent = sandbox_returning(stdout="")
    hung = sandbox_returning(timed_out=True, exit_code=None)

    for client in (crashed, silent, hung):
        with pytest.raises(ScoringError):
            await score_python_check(check_task(), "x", settings, client)
    with pytest.raises(ScoringError, match="needs the sandbox"):
        await score_python_check(check_task(), "x", Settings(sandbox_url=None))
    with pytest.raises(ScoringError, match="No checker named"):
        await score_python_check(
            task("python_check", checker="does_not_exist", expected=[]), "x", settings, crashed
        )
    with pytest.raises(ScoringError, match="Invalid checker name"):
        await score_python_check(
            task("python_check", checker="../../etc/passwd", expected=[]), "x", settings, crashed
        )


# -------------------------------------------------------------------- llm_judge


def judge_settings(**overrides: object) -> Settings:
    values: dict[str, Any] = {
        "judge_model": "test/free-model",
        "judge_model_family": "judge-family",
    }
    return Settings(**{**values, **overrides})


def judged_task() -> Any:  # noqa: ANN401
    return task("llm_judge", rubric="The answer names a bird.")


async def test_the_judge_verdict_and_reasoning_are_recorded() -> None:
    llm = ScriptedLLM(says('{"passed": true, "reasoning": "A kestrel is a bird."}'))

    verdict = await score_answer(
        judged_task(),
        "kestrel",
        settings=judge_settings(),
        llm=llm,
        contestant_families={"gemini", "qwen"},
        pricing=fakes.make_pricing(),
    )

    assert verdict.passed
    assert verdict.scorer_type == "llm_judge"
    assert verdict.explanation == "Judge (test/free-model): A kestrel is a bird."
    request = llm.requests[0]
    assert request["model"] == "test/free-model"
    assert "The answer names a bird." in request["messages"][1]["content"]
    assert "kestrel" in request["messages"][1]["content"]


async def test_a_judge_from_a_contestants_family_is_refused_before_any_call() -> None:
    llm = ScriptedLLM(says('{"passed": true, "reasoning": "x"}'))

    with pytest.raises(ScoringError, match="different family than every contestant"):
        await score_answer(
            judged_task(),
            "kestrel",
            settings=judge_settings(judge_model_family="gemini"),
            llm=llm,
            contestant_families={"gemini", "qwen"},
            pricing=fakes.make_pricing(),
        )

    assert llm.calls == 0


async def test_a_paid_judge_is_refused_before_any_call() -> None:
    from arena.pricing import ModelNotAllowedError

    llm = ScriptedLLM(says('{"passed": true, "reasoning": "x"}'))

    with pytest.raises(ModelNotAllowedError):
        await score_answer(
            judged_task(),
            "kestrel",
            settings=judge_settings(judge_model="test/paid-model"),
            llm=llm,
            contestant_families={"gemini"},
            pricing=fakes.make_pricing(),
        )

    assert llm.calls == 0


@pytest.mark.parametrize(
    "reply",
    ["I think it passes.", '{"passed": "yes"}', '{"reasoning": "no verdict"}', "{not json}"],
)
async def test_a_judge_reply_in_the_wrong_form_is_a_scoring_error(reply: str) -> None:
    with pytest.raises(ScoringError, match="required form"):
        await score_answer(
            judged_task(),
            "kestrel",
            settings=judge_settings(),
            llm=ScriptedLLM(says(reply)),
            contestant_families=set(),
            pricing=fakes.make_pricing(),
        )


async def test_a_judge_without_configuration_or_one_that_fails_is_a_scoring_error() -> None:
    with pytest.raises(ScoringError, match="none is configured"):
        await score_answer(judged_task(), "kestrel", settings=SETTINGS, llm=ScriptedLLM())
    with pytest.raises(ScoringError, match="judge call failed"):
        await score_answer(
            judged_task(),
            "kestrel",
            settings=judge_settings(),
            llm=ScriptedLLM(LLMCallError("down")),
            contestant_families=set(),
            pricing=fakes.make_pricing(),
        )


# ---------------------------------------------------------- scoring inside a run


async def run(tmp_path: Path, llm: ScriptedLLM, **options: Any) -> RunResult:  # noqa: ANN401
    return await run_agent(
        fakes.make_config(),
        options.pop("task", fakes.make_task()),
        llm=llm,
        settings=fakes.make_settings(tmp_path),
        pricing=fakes.make_pricing(),
        **options,
    )


async def test_a_run_ends_with_a_score_event_after_run_finished(tmp_path: Path) -> None:
    right = await run(tmp_path, ScriptedLLM(submits("42")))
    wrong = await run(tmp_path, ScriptedLLM(submits("41")))

    for result in (right, wrong):
        assert [event["type"] for event in result.events][-2:] == ["run_finished", "score_computed"]
    assert right.passed is True and right.score == 1.0
    assert wrong.passed is False and wrong.score == 0.0
    payload = right.events[-1]["payload"]
    assert payload == {
        "passed": True,
        "score": 1.0,
        "scorer_type": "exact",
        "explanation": "Matches the expected answer.",
        "checks": [],
    }


async def test_a_run_that_never_answers_is_scored_as_a_failure(tmp_path: Path) -> None:
    llm = ScriptedLLM(asks_for(tool_call("calculator", expression="1+1")), repeat_last=True)

    result = await run_agent(
        fakes.make_config(max_steps=2),
        fakes.make_task(),
        llm=llm,
        settings=fakes.make_settings(tmp_path),
        pricing=fakes.make_pricing(),
    )

    assert result.stop_reason == "max_steps"
    assert result.passed is False
    assert result.score_explanation == "The agent gave no answer."


async def test_an_abandoned_run_is_not_scored(tmp_path: Path) -> None:
    from arena.llm import RateLimitedError

    result = await run(tmp_path, ScriptedLLM(RateLimitedError("429")))

    assert result.abandoned
    assert result.passed is None
    assert "score_computed" not in [event["type"] for event in result.events]


async def test_a_scorer_that_cannot_run_leaves_the_run_unscored(tmp_path: Path) -> None:
    unscorable = fakes.make_task(
        scorer_type="python_check", scorer_config={"checker": "top_three_skus", "expected": []}
    )

    result = await run(tmp_path, ScriptedLLM(submits("SKU-001")), task=unscorable)

    assert result.passed is None
    types = [event["type"] for event in result.events]
    assert "score_computed" not in types
    assert types[-1] == "error"
    assert "could not be scored" in result.events[-1]["payload"]["message"]


async def test_scoring_can_be_switched_off(tmp_path: Path) -> None:
    result = await run(tmp_path, ScriptedLLM(submits("42")), score=False)

    assert result.passed is None
    assert [event["type"] for event in result.events][-1] == "run_finished"


# ------------------------------------------------------------------- eval table


async def test_evaluate_runs_each_task_once_and_summarises(tmp_path: Path) -> None:
    tasks = [
        fakes.make_task(id="t-pass", category="code"),
        fakes.make_task(id="t-fail", category="code"),
        fakes.make_task(id="t-skip", category="agent"),
    ]
    scripts = {
        "t-pass": ScriptedLLM(submits("42", prompt_tokens=300, completion_tokens=50)),
        "t-fail": ScriptedLLM(submits("7")),
        "t-skip": ScriptedLLM(LLMCallError("unused")),
    }
    from arena.llm import RateLimitedError

    scripts["t-skip"] = ScriptedLLM(RateLimitedError("429"))
    seen: list[str] = []

    async def run_one(item: Any) -> RunResult:  # noqa: ANN401
        return await run_agent(
            fakes.make_config(),
            item,
            llm=scripts[item.id],
            settings=fakes.make_settings(tmp_path),
            pricing=fakes.make_pricing(),
        )

    rows = await evaluate(tasks, run_one, on_row=lambda row: seen.append(row.task.id))

    assert seen == ["t-pass", "t-fail", "t-skip"]
    assert [row.outcome for row in rows] == ["pass", "fail", "not run"]
    summary = summarise(rows)
    assert summary[0] == "passed 1 of 2 runs with a right answer (50%)"
    assert "  code           1 of 2" in summary
    assert "not run (provider refused or rate-limited): 1" in summary
    assert summary[-1].startswith("tokens 470, actual cost $0.0000, at paid rates $")
    line = format_row(rows[0])
    assert line.startswith("t-pass     code           pass")
    assert line.rstrip().endswith("42")


def test_an_unscored_row_is_reported_as_unscored(tmp_path: Path) -> None:
    result = RunResult(
        run_id="r",
        stop_reason="answered",
        final_answer="x",
        steps=1,
        tool_calls=1,
        prompt_tokens=1,
        completion_tokens=1,
        cost_usd=0.0,
        reference_cost_usd=0.0,
        latency_ms=1,
        wall_clock_ms=1,
        abandoned=False,
    )

    row = EvalRow(fakes.make_task(), result)

    assert row.outcome == "unscored"
    assert "ran but could not be scored: 1" in summarise([row])
