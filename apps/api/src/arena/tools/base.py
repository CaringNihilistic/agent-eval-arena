"""The shape every arena tool shares. Both agent backends call tools through this."""

from dataclasses import dataclass
from typing import Any, Protocol

TRUNCATION_NOTE = "\n[output truncated]"


@dataclass(frozen=True)
class ToolResult:
    output: str
    success: bool = True
    error: str | None = None

    @classmethod
    def failure(cls, error: str, output: str = "") -> "ToolResult":
        return cls(output=output, success=False, error=error)


class Tool(Protocol):
    name: str
    description: str
    parameters: dict[str, Any]

    async def run(self, arguments: dict[str, Any]) -> ToolResult: ...


def function_schema(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    """The function-calling schema that model APIs expect."""
    return {
        "type": "function",
        "function": {"name": name, "description": description, "parameters": parameters},
    }


def string_argument(arguments: dict[str, Any], key: str) -> str | None:
    value = arguments.get(key)
    return value if isinstance(value, str) and value.strip() else None


def truncate(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars] + TRUNCATION_NOTE, True
