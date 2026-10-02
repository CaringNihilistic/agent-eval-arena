"""Runs hidden tests against code the agent wrote.

Runs inside the sandbox, because it executes the agent's code. `check` receives
the answer and the task's scorer_config, and returns (passed, explanation).

scorer_config:
  function: name of the function the answer must define
  cases:    list of {args: [...], expected: value} or {args: [...], raises: "ErrorName"}
"""

import copy
import re

_FENCE = re.compile(r"```[a-zA-Z]*\n(.*?)```", re.DOTALL)


def extract_code(answer: str) -> str:
    """The contents of the fenced blocks if there are any, otherwise the whole answer."""
    blocks = _FENCE.findall(answer)
    return "\n\n".join(blocks) if blocks else answer


def plain(value):
    """Tuples become lists, so a function may return either."""
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    return value


def run_case(function, case) -> tuple[bool, str]:
    args = copy.deepcopy(case["args"])
    shown = ", ".join(repr(arg) for arg in case["args"])
    try:
        result = function(*args)
    except Exception as error:  # The agent's code may raise anything.
        if case.get("raises") == type(error).__name__:
            return True, ""
        return False, f"{function.__name__}({shown}) raised {type(error).__name__}."
    if "raises" in case:
        return False, f"{function.__name__}({shown}) should raise {case['raises']}."
    got = plain(result)
    # True == 1 in Python, so the types must agree as well as the values.
    if got == case["expected"] and isinstance(got, bool) == isinstance(case["expected"], bool):
        return True, ""
    return False, f"{function.__name__}({shown}) returned {result!r}."


def check(answer: str, config: dict) -> tuple[bool, str]:
    namespace: dict = {}
    try:
        exec(compile(extract_code(answer), "answer.py", "exec"), namespace)
    except Exception as error:
        return False, f"The code could not be loaded: {type(error).__name__}: {error}"
    function = namespace.get(config["function"])
    if not callable(function):
        return False, f"The answer does not define a function named {config['function']}."

    cases = config["cases"]
    failures = []
    for case in cases:
        ok, message = run_case(function, case)
        if not ok:
            failures.append(message)
    passed = len(cases) - len(failures)
    summary = f"{passed} of {len(cases)} hidden tests passed."
    if failures:
        summary += f" First failure: {failures[0]}"
    return not failures, summary
