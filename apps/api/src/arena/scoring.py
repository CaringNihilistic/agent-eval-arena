"""Scorers: decide whether an agent's final answer is right.

Deterministic scorers come first. `llm_judge` exists for tasks that cannot be
checked any other way; no task in the recorded bank uses it.
"""

import json
import re
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from arena.config import Task
from arena.llm import LLMCallError, LLMClient
from arena.pricing import PricingTable, assert_runnable, default_pricing
from arena.settings import Settings

CHECK_TIMEOUT_S = 8.0
EPSILON = 1e-9

# A number as people write it: optional sign, thousands separators, decimals.
_NUMBER = re.compile(r"[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?\.\d+")
# Straight and curly quotes, and backticks.
_QUOTES = "\"'`" + "".join(chr(code) for code in (0x201C, 0x201D, 0x2018, 0x2019))


@dataclass(frozen=True)
class ScoreResult:
    passed: bool
    score: float
    scorer_type: str
    explanation: str


class ScoringError(Exception):
    """The answer could not be scored. This is not a wrong answer: nothing is recorded."""


def normalize(text: str) -> str:
    """Trim, lower-case, collapse whitespace, and drop wrapping quotes and a final full stop."""
    cleaned = " ".join(text.split()).strip(_QUOTES + " ").casefold()
    return cleaned.rstrip(".!").strip(_QUOTES + " ")


def numbers_in(text: str) -> list[float]:
    return [float(match.replace(",", "")) for match in _NUMBER.findall(text)]


def _result(task: Task, passed: bool, explanation: str) -> ScoreResult:
    return ScoreResult(passed, 1.0 if passed else 0.0, task.scorer_type, explanation)


def score_exact(task: Task, answer: str) -> ScoreResult:
    config = task.scorer_config
    accepted = [config["expected"], *config.get("also_accept", [])]
    given = normalize(answer)
    if given in {normalize(str(option)) for option in accepted}:
        return _result(task, True, "Matches the expected answer.")
    return _result(task, False, f"Expected {config['expected']!r}; the answer was {answer!r}.")


def score_numeric(task: Task, answer: str) -> ScoreResult:
    config = task.scorer_config
    expected = float(config["expected"])
    tolerance = float(config.get("tolerance", 0))
    found = sorted(set(numbers_in(answer)))
    if not found:
        return _result(task, False, f"No number found in the answer {answer!r}.")
    if len(found) > 1:
        # Guessing which number was meant would be scoring something the agent did not say.
        return _result(
            task, False, f"The answer contains several numbers ({found}); one was asked for."
        )
    value = found[0]
    if abs(value - expected) <= tolerance + EPSILON:
        return _result(task, True, f"{value:g} is within {tolerance:g} of {expected:g}.")
    return _result(task, False, f"Expected {expected:g} (within {tolerance:g}); got {value:g}.")


def score_regex(task: Task, answer: str) -> ScoreResult:
    config = task.scorer_config
    flags = re.IGNORECASE if config.get("case_insensitive") else 0
    if re.fullmatch(config["pattern"], normalize(answer), flags):
        return _result(task, True, "Matches the expected pattern.")
    return _result(task, False, f"The answer {answer!r} does not match the expected pattern.")


def checker_script(source: str, answer: str, config: dict[str, Any]) -> str:
    """The program the sandbox runs: the checker, then one call that prints JSON."""
    return (
        f"{source}\n\n"
        "import json as _json\n"
        f"_answer = _json.loads({json.dumps(json.dumps(answer))})\n"
        f"_config = _json.loads({json.dumps(json.dumps(config))})\n"
        "_passed, _explanation = check(_answer, _config)\n"
        'print(_json.dumps({"passed": bool(_passed), "explanation": str(_explanation)}))\n'
    )


async def score_python_check(
    task: Task, answer: str, settings: Settings, client: httpx.AsyncClient | None = None
) -> ScoreResult:
    name = str(task.scorer_config["checker"])
    path = _checker_path(settings, name)
    if settings.sandbox_url is None:
        raise ScoringError("python_check needs the sandbox, and none is configured.")
    payload = {
        "code": checker_script(path.read_text(encoding="utf-8"), answer, task.scorer_config),
        "timeout_s": CHECK_TIMEOUT_S,
    }
    try:
        if client is not None:
            response = await client.post(f"{settings.sandbox_url}/exec", json=payload)
        else:
            async with httpx.AsyncClient(timeout=CHECK_TIMEOUT_S + 10) as own:
                response = await own.post(f"{settings.sandbox_url}/exec", json=payload)
    except httpx.HTTPError as error:
        raise ScoringError(f"The sandbox is unreachable ({type(error).__name__}).") from error
    if response.status_code != 200:
        raise ScoringError(f"The sandbox returned HTTP {response.status_code}.")
    body = response.json()
    if body["timed_out"] or body["exit_code"] != 0:
        raise ScoringError(f"The checker {name!r} failed: {str(body['stderr'])[-300:]}")
    try:
        verdict = json.loads(str(body["stdout"]).strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as error:
        raise ScoringError(f"The checker {name!r} printed no verdict.") from error
    return _result(task, bool(verdict["passed"]), str(verdict["explanation"]))


def _checker_path(settings: Settings, name: str) -> Path:
    if not re.fullmatch(r"[a-z0-9_]+", name):
        raise ScoringError(f"Invalid checker name {name!r}.")
    path = settings.tasks_dir / "checkers" / f"{name}.py"
    if not path.is_file():
        raise ScoringError(f"No checker named {name!r}.")
    return path


JUDGE_INSTRUCTIONS = (
    "You are grading one answer to one task. Decide whether the answer meets the rubric. "
    'Reply with a JSON object only: {"passed": true or false, "reasoning": "one or two '
    'sentences"}.'
)


def check_judge_independence(judge_family: str, contestant_families: Collection[str]) -> None:
    """A judge from a contestant's model family may favour its own kind."""
    if judge_family in contestant_families:
        raise ScoringError(
            f"The judge's model family ({judge_family}) is also a contestant's. A judge must "
            "come from a different family than every contestant."
        )


async def score_llm_judge(
    task: Task,
    answer: str,
    *,
    settings: Settings,
    llm: LLMClient | None,
    contestant_families: Collection[str],
    pricing: PricingTable | None = None,
) -> ScoreResult:
    if llm is None or settings.judge_model is None or settings.judge_model_family is None:
        raise ScoringError("llm_judge needs a judge model, and none is configured.")
    check_judge_independence(settings.judge_model_family, contestant_families)
    # The judge is a model call like any other: it must be free too.
    assert_runnable(
        pricing or default_pricing(),
        settings.judge_model,
        "litellm",
        allow_paid=settings.allow_paid_models,
    )
    question = (
        f"Task:\n{task.prompt}\n\nRubric:\n{task.scorer_config['rubric']}\n\n"
        f"Answer to grade:\n{answer}"
    )
    try:
        response = await llm.complete(
            model=settings.judge_model,
            messages=[
                {"role": "system", "content": JUDGE_INSTRUCTIONS},
                {"role": "user", "content": question},
            ],
            tools=[],
            temperature=None,
            max_tokens=400,
        )
    except LLMCallError as error:
        raise ScoringError(f"The judge call failed: {error}") from error
    match = re.search(r"\{.*\}", response.content or "", re.DOTALL)
    try:
        verdict = json.loads(match.group(0)) if match else None
    except json.JSONDecodeError:
        verdict = None
    if not isinstance(verdict, dict) or not isinstance(verdict.get("passed"), bool):
        raise ScoringError("The judge did not return a verdict in the required form.")
    reasoning = str(verdict.get("reasoning", "")).strip() or "No reasoning given."
    return _result(task, verdict["passed"], f"Judge ({settings.judge_model}): {reasoning}")


async def score_answer(
    task: Task,
    answer: str | None,
    *,
    settings: Settings,
    llm: LLMClient | None = None,
    contestant_families: Collection[str] = (),
    pricing: PricingTable | None = None,
) -> ScoreResult:
    """Score a final answer. A missing answer fails without calling any scorer."""
    if answer is None or not answer.strip():
        return _result(task, False, "The agent gave no answer.")
    if task.scorer_type == "exact":
        return score_exact(task, answer)
    if task.scorer_type == "numeric_tolerance":
        return score_numeric(task, answer)
    if task.scorer_type == "regex":
        return score_regex(task, answer)
    if task.scorer_type == "python_check":
        return await score_python_check(task, answer, settings)
    return await score_llm_judge(
        task,
        answer,
        settings=settings,
        llm=llm,
        contestant_families=contestant_families,
        pricing=pricing,
    )
