"""Reads text files from the read-only fixtures folder, and nothing outside it."""

from pathlib import Path
from typing import Any

from arena.tools.base import ToolResult, string_argument

MAX_FILE_BYTES = 200_000


class ReadFile:
    name = "read_file"
    description = (
        "Read a text file from the fixtures folder. Pass a path relative to that folder, for "
        "example 'dev_sales.csv'. Pass '.' to list the files available."
    )
    parameters: dict[str, Any] = {  # noqa: RUF012 - read-only schema
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path inside the fixtures folder"}
        },
        "required": ["path"],
    }

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def _resolve(self, path: str) -> Path | None:
        """The real location of `path`, or None if it is outside the fixtures folder.

        Resolving follows symlinks and `..`, so an escape by either route lands
        outside the root and is refused.
        """
        candidate = (self._root / path).resolve()
        return candidate if candidate.is_relative_to(self._root) else None

    def _listing(self, folder: Path) -> str:
        names = sorted(
            str(p.relative_to(self._root)).replace("\\", "/")
            for p in folder.rglob("*")
            if p.is_file()
        )
        return "\n".join(names) if names else "(no files)"

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        path = string_argument(arguments, "path")
        if path is None:
            return ToolResult.failure("'path' must be a non-empty string")
        target = self._resolve(path)
        if target is None:
            return ToolResult.failure("path is outside the fixtures folder")
        if target.is_dir():
            return ToolResult(self._listing(target))
        if not target.is_file():
            return ToolResult.failure(f"no such file: {path}")
        if target.stat().st_size > MAX_FILE_BYTES:
            return ToolResult.failure(
                f"file is larger than {MAX_FILE_BYTES} bytes; use python_exec to process it"
            )
        try:
            return ToolResult(target.read_text(encoding="utf-8"))
        except UnicodeDecodeError:
            return ToolResult.failure("file is not UTF-8 text")
