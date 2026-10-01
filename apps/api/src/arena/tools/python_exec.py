"""Runs Python in the sandbox container. Nothing executes in this process."""

from typing import Any

import httpx

from arena.tools.base import ToolResult, string_argument

EXEC_TIMEOUT_S = 8.0
# The HTTP timeout must outlast the sandbox's own limit, or a slow run looks like an outage.
HTTP_TIMEOUT_S = EXEC_TIMEOUT_S + 10.0


class PythonExec:
    name = "python_exec"
    description = (
        "Run Python 3.11 code in an isolated sandbox and return what it prints. numpy and "
        "pandas are available. There is no network. Fixture files are in the folder named by "
        f"the FIXTURES_DIR environment variable. The time limit is {EXEC_TIMEOUT_S:.0f} seconds."
    )
    parameters: dict[str, Any] = {  # noqa: RUF012 - read-only schema
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "A complete Python script. Use print()."}
        },
        "required": ["code"],
    }

    def __init__(self, sandbox_url: str | None, client: httpx.AsyncClient | None = None) -> None:
        self._sandbox_url = sandbox_url
        self._client = client

    async def _post(self, code: str) -> httpx.Response:
        payload = {"code": code, "timeout_s": EXEC_TIMEOUT_S}
        url = f"{self._sandbox_url}/exec"
        if self._client is not None:
            return await self._client.post(url, json=payload)
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
            return await client.post(url, json=payload)

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        code = string_argument(arguments, "code")
        if code is None:
            return ToolResult.failure("'code' must be a non-empty string")
        if self._sandbox_url is None:
            return ToolResult.failure("the sandbox is not configured")
        try:
            response = await self._post(code)
        except httpx.HTTPError as error:
            return ToolResult.failure(f"the sandbox is unreachable ({type(error).__name__})")
        if response.status_code == 422:
            return ToolResult.failure("the sandbox rejected the code (too long or empty)")
        if response.status_code != 200:
            return ToolResult.failure(f"the sandbox returned HTTP {response.status_code}")

        body = response.json()
        stdout, stderr = str(body["stdout"]), str(body["stderr"])
        if body["timed_out"]:
            return ToolResult.failure(f"timed out after {EXEC_TIMEOUT_S:.0f} seconds", stdout)
        if body["exit_code"] != 0:
            # The last lines of a traceback are the useful part.
            return ToolResult.failure(stderr.strip()[-1500:] or "the script failed", stdout)
        return ToolResult(stdout if stdout else "(no output)")
