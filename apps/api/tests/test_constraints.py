"""Constraint checks for open-ended answers, the code-test checker, and how both
show up in a run."""

from pathlib import Path
from typing import Any

import pytest

from arena.constraints import (
    ConstraintConfigError,
    count_sentences,
    count_words,
    mermaid_kind,
    run_check,
    run_checks,
    strip_fence,
)
from arena.runner import run_agent
from arena.scoring import (
    ScoringError,
    parse_mermaid_in_sandbox,
    score_answer,
    score_constraints,
)
from arena.settings import get_settings
from tests import fakes
from tests.fakes import ScriptedLLM, says, submits

SETTINGS = get_settings()


async def no_parser(_code: str) -> tuple[bool, str]:
    raise AssertionError("this check must not need the Mermaid parser")


async def accepts(_code: str) -> tuple[bool, str]:
    return True, "The Mermaid parser accepted the diagram."


async def rejects(_code: str) -> tuple[bool, str]:
    return False, "The Mermaid parser rejected the diagram: Parse error on line 2"


async def check(spec: dict[str, Any], answer: str, parser: Any = no_parser) -> bool:  # noqa: ANN401
    return (await run_check(spec, answer, parser)).passed


# ------------------------------------------------------------------------ counting


@pytest.mark.parametrize(
    ("text", "words"),
    [
        ("one two three", 3),
        ("It's a 15-minute call, isn't it?", 6),
        ("Subject: Fewer no-shows\n\nHi there.", 5),
        ("", 0),
        ("  spaced   out  ", 2),
        ("$50 and 3.5 kg", 5),
    ],
)
def test_count_words(text: str, words: int) -> None:
    assert count_words(text) == words


@pytest.mark.parametrize(
    ("text", "sentences"),
    [
        ("One. Two! Three?", 3),
        ("No terminal punctuation", 0),
        ('He said "stop." Then he left.', 2),
        ("Wait... what happened?", 2),
        ("Version 2.5 is out. It is fast.", 2),
    ],
)
def test_count_sentences(text: str, sentences: int) -> None:
    assert count_sentences(text) == sentences


def test_strip_fence_and_mermaid_kind() -> None:
    fenced = "Here you go:\n```mermaid\nflowchart TD\n  A --> B\n```\nDone."

    assert strip_fence(fenced) == "flowchart TD\n  A --> B"
    assert strip_fence("sequenceDiagram\n  A->>B: hi") == "sequenceDiagram\n  A->>B: hi"
    assert mermaid_kind("flowchart TD\n A-->B") == "flowchart"
    assert mermaid_kind("graph LR\n A-->B") == "flowchart"
    assert mermaid_kind("%% comment\nstateDiagram-v2\n [*] --> A") == "stateDiagram"
    assert mermaid_kind("sequenceDiagram\n A->>B: x") == "sequenceDiagram"
    assert mermaid_kind("Here is a diagram") is None


# ------------------------------------------------------------------------ each check


async def test_word_and_line_limits() -> None:
    assert await check({"type": "max_words", "value": 3}, "one two three")
    assert not await check({"type": "max_words", "value": 3}, "one two three four")
    assert await check({"type": "max_lines", "value": 2}, "a\n\nb\n")
    assert not await check({"type": "max_lines", "value": 2}, "a\nb\nc")
    # A fence around a diagram does not count against its line limit.
    assert await check(
        {"type": "max_lines", "value": 2}, "```mermaid\nflowchart TD\n  A --> B\n```"
    )


async def test_sentence_limits() -> None:
    exactly_three = {"type": "sentences", "min": 3, "max": 3}

    assert await check(exactly_three, "One. Two. Three.")
    assert not await check(exactly_three, "One. Two.")
    assert not await check(exactly_three, "One. Two. Three. Four.")
    assert (await run_check(exactly_three, "One.", no_parser)).name == "exactly 3 sentences"


async def test_section_and_first_line_checks() -> None:
    answer = "**Stack:** Next.js, Postgres\n\nReasoning:\n- one\n- two\n- three\n"

    assert await check({"type": "section", "label": "Stack:"}, answer)
    assert await check({"type": "section", "label": "reasoning:"}, answer)
    assert not await check({"type": "section", "label": "Risks:"}, answer)
    assert await check({"type": "starts_with", "label": "Stack:"}, answer)
    assert not await check({"type": "starts_with", "label": "Reasoning:"}, answer)
    assert not await check({"type": "starts_with", "label": "Stack:"}, "")


async def test_lines_under_a_section() -> None:
    spec = {"type": "section_lines", "label": "Reasoning:", "min": 3, "max": 5, "until": ["Stack:"]}

    assert await check(spec, "Stack: X\nReasoning:\na\nb\nc")
    assert await check(spec, "Reasoning:\na\nb\nc\nd\ne\nStack: X")
    assert not await check(spec, "Stack: X\nReasoning:\na\nb")
    assert not await check(spec, "Stack: X\nReasoning:\na\nb\nc\nd\ne\nf")
    # Text on the label's own line counts as a line.
    assert await check(spec, "Stack: X\nReasoning: a\nb\nc")
    missing = await run_check(spec, "Stack: X", no_parser)
    assert not missing.passed and "No line starting with" in missing.detail


async def test_mentions_excludes_and_pattern() -> None:
    any_of = {"type": "mentions", "name": "names the product", "any_of": ["Slotwise", "slot wise"]}
    all_of = {"type": "mentions", "name": "components", "all_of": ["Web App", "Redis"]}
    banned = {"type": "excludes", "name": "no price", "terms": ["$", "price"]}
    first_person = {"type": "pattern", "name": "first person", "pattern": r"\b(I|my)\b"}

    assert await check(any_of, "Try SLOTWISE today")
    assert not await check(any_of, "Try our app today")
    assert await check(all_of, "web app -> redis")
    missing = await run_check(all_of, "Web App only", no_parser)
    assert not missing.passed and missing.detail == "Not found: Redis."
    assert await check(banned, "A fine backpack.")
    assert not await check(banned, "Only $89.")
    assert await check(first_person, "I kept the light.")
    assert not await check(first_person, "The keeper kept it. Imagine that.")


async def test_mermaid_check_needs_the_right_kind_and_a_clean_parse() -> None:
    spec = {"type": "mermaid", "diagram": "flowchart"}
    flowchart = "flowchart TD\n  A --> B"

    assert await check(spec, flowchart, accepts)
    assert await check(spec, f"```mermaid\n{flowchart}\n```", accepts)
    rejected = await run_check(spec, flowchart, rejects)
    assert not rejected.passed and "Parse error" in rejected.detail
    # The wrong kind of diagram fails without asking the parser.
    wrong_kind = await run_check(spec, "sequenceDiagram\n  A->>B: hi", no_parser)
    assert not wrong_kind.passed and "Expected a flowchart" in wrong_kind.detail
    prose = await run_check(spec, "Here is the process in words.", no_parser)
    assert not prose.passed and "something else" in prose.detail


async def test_a_malformed_constraint_is_a_task_bug_not_a_failed_check() -> None:
    with pytest.raises(ConstraintConfigError, match="Unknown constraint type"):
        await run_check({"type": "vibes"}, "x", no_parser)
    with pytest.raises(ConstraintConfigError, match="missing"):
        await run_check({"type": "max_words"}, "x", no_parser)
    with pytest.raises(ConstraintConfigError, match="at least one check"):
        await run_checks([], "x", no_parser)
    broken = fakes.make_task(
        scorer_type="constraints", scorer_config={"checks": [{"type": "vibes"}]}
    )
    with pytest.raises(ScoringError):
        await score_constraints(broken, "x", SETTINGS, no_parser)


# -------------------------------------------------------------- scoring an answer


def open_task() -> Any:  # noqa: ANN401
    return fakes.make_task(
        category="writing",
        scorer_type="constraints",
        scorer_config={
            "checks": [
                {"type": "max_words", "value": 8},
                {"type": "mentions", "name": "names the product", "any_of": ["Slotwise"]},
                {"type": "starts_with", "label": "Subject:"},
            ]
        },
    )


async def test_constraint_score_is_a_count_not_a_pass() -> None:
    all_met = await score_answer(open_task(), "Subject: Try Slotwise today", settings=SETTINGS)
    some_met = await score_answer(open_task(), "Hello, try Slotwise today", settings=SETTINGS)

    assert all_met.passed is None and some_met.passed is None
    assert (all_met.constraints_met, len(all_met.checks)) == (3, 3)
    assert all_met.score == 1.0
    assert all_met.explanation == "Constraints met: 3 of 3."
    assert some_met.score == pytest.approx(2 / 3)
    assert some_met.explanation == "Constraints met: 2 of 3. Not met: starts with 'Subject:'."
    assert [check.passed for check in some_met.checks] == [True, True, False]


async def test_a_mermaid_task_without_a_sandbox_is_unscored_not_failed() -> None:
    diagram = fakes.make_task(
        category="diagram",
        scorer_type="constraints",
        scorer_config={"checks": [{"type": "mermaid", "diagram": "flowchart"}]},
    )

    with pytest.raises(ScoringError, match="needs the sandbox"):
        await score_answer(
            diagram,
            "flowchart TD\n  A --> B",
            settings=SETTINGS.model_copy(update={"sandbox_url": None}),
        )


# --------------------------------------------------------------- inside a run


async def test_an_open_ended_run_records_its_checks_and_its_length(tmp_path: Path) -> None:
    answer = "Subject: Try Slotwise today"

    result = await run_agent(
        fakes.make_config(),
        open_task(),
        llm=ScriptedLLM(says(answer)),
        settings=fakes.make_settings(tmp_path),
        pricing=fakes.make_pricing(),
    )

    assert result.passed is None
    assert result.score == 1.0
    assert result.answer_words == 4
    payload = result.events[-1]["payload"]
    assert result.events[-1]["type"] == "score_computed"
    assert payload["passed"] is None
    assert payload["scorer_type"] == "constraints"
    assert payload["explanation"] == "Constraints met: 3 of 3."
    assert payload["checks"] == result.checks
    assert payload["checks"][0] == {
        "name": "at most 8 words",
        "passed": True,
        "detail": "4 words; at most 8 allowed.",
    }


async def test_a_right_answer_run_has_no_checks(tmp_path: Path) -> None:
    result = await run_agent(
        fakes.make_config(),
        fakes.make_task(),
        llm=ScriptedLLM(submits("42")),
        settings=fakes.make_settings(tmp_path),
        pricing=fakes.make_pricing(),
    )

    assert result.passed is True
    assert result.checks == []
    assert result.events[-1]["payload"]["checks"] == []
    assert result.answer_words == 1


# ------------------------------------------------------ the code-test checker


def load_checker() -> Any:  # noqa: ANN401
    source = (SETTINGS.tasks_dir / "checkers" / "code_tests.py").read_text(encoding="utf-8")
    namespace: dict[str, Any] = {}
    exec(source, namespace)
    return namespace["check"]


CONFIG = {
    "function": "double",
    "cases": [
        {"args": [2], "expected": 4},
        {"args": [0], "expected": 0},
        {"args": ["x"], "raises": "TypeError"},
    ],
}
GOOD = (
    "def double(n):\n"
    "    if not isinstance(n, int):\n"
    "        raise TypeError('int only')\n"
    "    return n * 2"
)


def test_code_checker_passes_correct_code_plain_or_fenced() -> None:
    check_code = load_checker()

    assert check_code(GOOD, CONFIG) == (True, "3 of 3 hidden tests passed.")
    assert check_code(f"Here is the fix:\n```python\n{GOOD}\n```\nIt handles strings.", CONFIG)[0]


def test_code_checker_reports_the_first_failure() -> None:
    check_code = load_checker()

    passed, explanation = check_code("def double(n):\n    return n + 2", CONFIG)

    assert not passed
    assert explanation == "2 of 3 hidden tests passed. First failure: double(0) returned 2."


@pytest.mark.parametrize(
    ("answer", "message"),
    [
        ("def double(n)\n    return n", "The code could not be loaded: SyntaxError"),
        ("def twice(n):\n    return n * 2", "does not define a function named double"),
        ("double = 4", "does not define a function named double"),
        ("The bug is on line two.", "The code could not be loaded"),
        ("raise SystemError('boom')", "The code could not be loaded: SystemError"),
    ],
)
def test_code_checker_rejects_answers_that_are_not_working_code(answer: str, message: str) -> None:
    passed, explanation = load_checker()(answer, CONFIG)

    assert not passed
    assert message in explanation


def test_code_checker_does_not_confuse_true_with_one_or_tuples_with_lists() -> None:
    check_code = load_checker()
    one = {"function": "f", "cases": [{"args": [], "expected": 1}]}
    pair = {"function": "f", "cases": [{"args": [], "expected": [1, 2]}]}

    assert not check_code("def f():\n    return True", one)[0]
    assert check_code("def f():\n    return 1", one)[0]
    assert check_code("def f():\n    return (1, 2)", pair)[0]


def test_code_checker_gives_each_case_a_fresh_copy_of_its_arguments() -> None:
    config: dict[str, Any] = {
        "function": "drain",
        "cases": [{"args": [[1, 2]], "expected": 2}, {"args": [[1, 2]], "expected": 2}],
    }

    passed, _ = load_checker()(
        "def drain(items):\n    n = len(items)\n    items.clear()\n    return n", config
    )

    assert passed
    assert config["cases"][0]["args"] == [[1, 2]]


async def test_a_parser_failure_is_a_scoring_error_not_a_rejected_diagram(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A parser that timed out says nothing about the diagram. Scoring it as
    invalid would record a wrong result; the run must be left unscored instead."""

    class Unavailable:
        status_code = 503

        def json(self) -> dict[str, str]:
            return {"detail": "The parser did not finish in time."}

    class Client:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

        async def post(self, _url: str, **_kwargs: object) -> Unavailable:
            return Unavailable()

    monkeypatch.setattr("arena.scoring.httpx.AsyncClient", Client)
    settings = SETTINGS.model_copy(update={"sandbox_url": "http://sandbox:8001"})

    with pytest.raises(ScoringError, match="HTTP 503"):
        await parse_mermaid_in_sandbox(settings, "flowchart TD\n  A --> B")
