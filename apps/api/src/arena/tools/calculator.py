"""Arithmetic without eval(): the expression is parsed and only whitelisted nodes run."""

import ast
import math
import operator
from collections.abc import Callable
from typing import Any

from arena.tools.base import ToolResult, string_argument

MAX_EXPRESSION_CHARS = 500
MAX_NODES = 200
MAX_EXPONENT = 1000
MAX_ABS_VALUE = 1e300

Number = int | float

_BINARY: dict[type[ast.operator], Callable[[Number, Number], Number]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
}
_UNARY: dict[type[ast.unaryop], Callable[[Number], Number]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
_FUNCTIONS: dict[str, Callable[..., Number]] = {
    "sqrt": math.sqrt,
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "floor": math.floor,
    "ceil": math.ceil,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
}
_CONSTANTS: dict[str, float] = {"pi": math.pi, "e": math.e}


class CalculatorError(ValueError):
    """The expression is not arithmetic this tool accepts."""


def _check(value: Number) -> Number:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise CalculatorError("result is not a number")
    if isinstance(value, float) and not math.isfinite(value):
        raise CalculatorError("result is not finite")
    if abs(value) > MAX_ABS_VALUE:
        raise CalculatorError("result is too large")
    return value


def _power(base: Number, exponent: Number) -> Number:
    if abs(exponent) > MAX_EXPONENT:
        raise CalculatorError(f"exponent magnitude is limited to {MAX_EXPONENT}")
    result = base**exponent
    if isinstance(result, complex):
        raise CalculatorError("result is not a real number")
    return result


def _eval(node: ast.AST) -> Number:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, int | float):
            raise CalculatorError("only numbers are allowed")
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in _CONSTANTS:
            raise CalculatorError(f"unknown name {node.id!r}")
        return _CONSTANTS[node.id]
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _check(_UNARY[type(node.op)](_eval(node.operand)))
    if isinstance(node, ast.BinOp):
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, ast.Pow):
            return _check(_power(left, right))
        if type(node.op) in _BINARY:
            return _check(_BINARY[type(node.op)](left, right))
        raise CalculatorError("operator is not supported")
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCTIONS:
            raise CalculatorError("only the listed functions can be called")
        if node.keywords:
            raise CalculatorError("keyword arguments are not supported")
        return _check(_FUNCTIONS[node.func.id](*[_eval(arg) for arg in node.args]))
    raise CalculatorError(f"{type(node).__name__} is not allowed in an expression")


def evaluate(expression: str) -> Number:
    if len(expression) > MAX_EXPRESSION_CHARS:
        raise CalculatorError(f"expression is longer than {MAX_EXPRESSION_CHARS} characters")
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except SyntaxError as error:
        raise CalculatorError(f"not a valid expression: {error.msg}") from error
    if sum(1 for _ in ast.walk(tree)) > MAX_NODES:
        raise CalculatorError("expression is too complex")
    try:
        return _eval(tree.body)
    except ZeroDivisionError as error:
        raise CalculatorError("division by zero") from error
    except (OverflowError, ValueError, TypeError) as error:
        if isinstance(error, CalculatorError):
            raise
        raise CalculatorError(str(error)) from error


def format_number(value: Number) -> str:
    if isinstance(value, int):
        return str(value)
    if value.is_integer() and abs(value) < 1e15:
        return str(int(value))
    return format(value, ".12g")


class Calculator:
    name = "calculator"
    description = (
        "Evaluate one arithmetic expression and return the number. Supports + - * / // % **, "
        "parentheses, the functions sqrt, abs, round, min, max, floor, ceil, log, log10, exp, "
        "sin, cos, tan, and the constants pi and e."
    )
    parameters: dict[str, Any] = {  # noqa: RUF012 - read-only schema
        "type": "object",
        "properties": {
            "expression": {"type": "string", "description": "For example: (37 * 4.85) * 0.92"}
        },
        "required": ["expression"],
    }

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        expression = string_argument(arguments, "expression")
        if expression is None:
            return ToolResult.failure("'expression' must be a non-empty string")
        try:
            return ToolResult(format_number(evaluate(expression)))
        except CalculatorError as error:
            return ToolResult.failure(str(error))
