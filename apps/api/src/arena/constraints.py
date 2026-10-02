"""Constraint checks for open-ended answers.

These check whether an answer respects the limits the task stated: a word limit,
required sections, things that had to be mentioned, a diagram that parses. They
say nothing about whether the answer is good. Quality is decided by votes.
"""

import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

# Typographic apostrophe and closing double quote, which models often produce.
_APOSTROPHE = chr(0x2019)
_CLOSE_QUOTE = chr(0x201D)
_WORD = re.compile(f"[A-Za-z0-9]+(?:['{_APOSTROPHE}-][A-Za-z0-9]+)*")
_SENTENCE_END = re.compile(f"[.!?]+(?:[\"'{_CLOSE_QUOTE}{_APOSTROPHE})\\]]*)(?=\\s|$)")
_FENCE = re.compile(r"```[a-zA-Z]*\n(.*?)```", re.DOTALL)
# Characters that may decorate a section label: markdown emphasis, headings, bullets.
_DECORATION = "#*_ >-\t"

# The first word of a Mermaid diagram, mapped to the family the task names.
MERMAID_KINDS = {
    "flowchart": "flowchart",
    "graph": "flowchart",
    "sequenceDiagram": "sequenceDiagram",
    "stateDiagram": "stateDiagram",
    "stateDiagram-v2": "stateDiagram",
    "erDiagram": "erDiagram",
    "classDiagram": "classDiagram",
}

MermaidParser = Callable[[str], Awaitable[tuple[bool, str]]]


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str

    def as_payload(self) -> dict[str, Any]:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


class ConstraintConfigError(Exception):
    """A task's constraint list is malformed. A bug in the task, not in the answer."""


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def count_sentences(text: str) -> int:
    return len(_SENTENCE_END.findall(text.strip()))


def content_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.strip()]


def strip_fence(text: str) -> str:
    """The contents of the first fenced code block, or the whole text if there is none."""
    match = _FENCE.search(text)
    return (match.group(1) if match else text).strip()


def mermaid_kind(code: str) -> str | None:
    for line in code.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("%%"):
            return MERMAID_KINDS.get(stripped.split()[0])
    return None


def _label_of(line: str) -> str:
    return line.strip().lstrip(_DECORATION).casefold()


def _find_section(lines: list[str], label: str) -> int | None:
    wanted = label.casefold()
    for index, line in enumerate(lines):
        if _label_of(line).startswith(wanted):
            return index
    return None


def _section_lines(text: str, label: str, until: list[str]) -> int | None:
    """Non-empty lines belonging to a section: any text after the label on its own
    line, then every line up to the next section label or the end."""
    lines = content_lines(text)
    start = _find_section(lines, label)
    if start is None:
        return None
    rest = lines[start].strip().lstrip(_DECORATION)[len(label) :].strip(" *_:")
    count = 1 if rest else 0
    stops = [other.casefold() for other in until]
    for line in lines[start + 1 :]:
        if any(_label_of(line).startswith(stop) for stop in stops):
            break
        count += 1
    return count


def _contains(text: str, term: str) -> bool:
    return term.casefold() in text.casefold()


def _limit(value: int, low: int | None, high: int | None, unit: str) -> tuple[bool, str]:
    passed = (low is None or value >= low) and (high is None or value <= high)
    if low is not None and high is not None:
        wanted = f"exactly {low}" if low == high else f"{low} to {high}"
    elif high is not None:
        wanted = f"at most {high}"
    else:
        wanted = f"at least {low}"
    return passed, f"{value} {unit}; {wanted} allowed."


async def run_check(
    spec: Mapping[str, Any], answer: str, parse_mermaid: MermaidParser
) -> CheckResult:
    kind = spec.get("type")
    try:
        if kind == "max_words":
            passed, detail = _limit(count_words(answer), None, int(spec["value"]), "words")
            name = f"at most {spec['value']} words"
        elif kind == "max_lines":
            line_count = len(content_lines(strip_fence(answer)))
            passed, detail = _limit(line_count, None, int(spec["value"]), "lines")
            name = f"at most {spec['value']} lines"
        elif kind == "sentences":
            low, high = spec.get("min"), spec.get("max")
            passed, detail = _limit(count_sentences(answer), low, high, "sentences")
            name = detail.split("; ")[1].replace(" allowed.", " sentences")
        elif kind == "section":
            label = str(spec["label"])
            passed = _find_section(content_lines(answer), label) is not None
            detail = f"A line starting with '{label}' was {'found' if passed else 'not found'}."
            name = f"has a line starting with '{label}'"
        elif kind == "starts_with":
            label = str(spec["label"])
            first = content_lines(answer)[:1]
            passed = bool(first) and _label_of(first[0]).startswith(label.casefold())
            detail = f"The first line {'starts' if passed else 'does not start'} with '{label}'."
            name = f"starts with '{label}'"
        elif kind == "section_lines":
            label = str(spec["label"])
            count = _section_lines(answer, label, list(spec.get("until", [])))
            name = f"{spec['min']} to {spec['max']} lines under '{label}'"
            if count is None:
                passed, detail = False, f"No line starting with '{label}' was found."
            else:
                passed, detail = _limit(count, int(spec["min"]), int(spec["max"]), "lines")
        elif kind == "mentions":
            name = str(spec["name"])
            if "all_of" in spec:
                missing = [term for term in spec["all_of"] if not _contains(answer, term)]
                passed = not missing
                detail = "All were found." if passed else f"Not found: {', '.join(missing)}."
            else:
                found = [term for term in spec["any_of"] if _contains(answer, term)]
                passed = bool(found)
                detail = (
                    f"Found '{found[0]}'." if passed else "None of the accepted terms was found."
                )
        elif kind == "excludes":
            name = str(spec["name"])
            present = [term for term in spec["terms"] if _contains(answer, term)]
            passed = not present
            detail = "Not present." if passed else f"Found: {', '.join(present)}."
        elif kind == "pattern":
            name = str(spec["name"])
            passed = re.search(str(spec["pattern"]), answer) is not None
            detail = "Found." if passed else "Not found."
        elif kind == "mermaid":
            wanted = str(spec["diagram"])
            name = f"a Mermaid {wanted} that parses"
            code = strip_fence(answer)
            actual = mermaid_kind(code)
            if actual != wanted:
                passed = False
                detail = f"Expected a {wanted}; the answer starts as {actual or 'something else'}."
            else:
                passed, detail = await parse_mermaid(code)
        else:
            raise ConstraintConfigError(f"Unknown constraint type {kind!r}.")
    except KeyError as error:
        raise ConstraintConfigError(f"Constraint {kind!r} is missing {error}.") from error
    return CheckResult(name, passed, detail)


async def run_checks(
    specs: list[Mapping[str, Any]], answer: str, parse_mermaid: MermaidParser
) -> list[CheckResult]:
    if not specs:
        raise ConstraintConfigError("A constraints task needs at least one check.")
    return [await run_check(spec, answer, parse_mermaid) for spec in specs]
