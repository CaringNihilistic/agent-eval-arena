"""Builds the tool set for a config. Shared by every agent backend."""

from collections.abc import Sequence
from typing import Any

from arena.settings import Settings
from arena.tools.base import Tool, function_schema
from arena.tools.calculator import Calculator
from arena.tools.python_exec import PythonExec
from arena.tools.read_file import ReadFile
from arena.tools.search_docs import SearchDocs

ALL_TOOL_NAMES = ("calculator", "python_exec", "search_docs", "read_file")

# A control tool, always available and not part of a config's enabled tools.
SUBMIT_ANSWER = "submit_answer"
SUBMIT_ANSWER_DESCRIPTION = (
    "Submit your final answer and end the task. Pass only the answer, in exactly the format "
    "the task asks for."
)
SUBMIT_ANSWER_PARAMETERS: dict[str, Any] = {
    "type": "object",
    "properties": {"answer": {"type": "string", "description": "The final answer only"}},
    "required": ["answer"],
}


def build_tools(enabled: Sequence[str], settings: Settings) -> dict[str, Tool]:
    available: dict[str, Tool] = {
        "calculator": Calculator(),
        "python_exec": PythonExec(settings.sandbox_url),
        "search_docs": SearchDocs(settings.corpus_dir),
        "read_file": ReadFile(settings.fixtures_dir),
    }
    return {name: available[name] for name in ALL_TOOL_NAMES if name in enabled}


def tool_schemas(tools: dict[str, Tool]) -> list[dict[str, Any]]:
    """Schemas in a fixed order, so the same config always sends the same request."""
    schemas = [function_schema(t.name, t.description, t.parameters) for t in tools.values()]
    schemas.append(
        function_schema(SUBMIT_ANSWER, SUBMIT_ANSWER_DESCRIPTION, SUBMIT_ANSWER_PARAMETERS)
    )
    return schemas
