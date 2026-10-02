"""Sandbox HTTP service: executes Python for the arena's python_exec tool and checkers."""

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from sandbox import __version__
from sandbox.executor import ExecLimits, MermaidUnavailableError, execute, parse_mermaid

MAX_CODE_CHARS = 20_000
MAX_TIMEOUT_S = 10.0
FIXTURES_DIR = Path(os.environ.get("SANDBOX_FIXTURES_DIR", "/fixtures"))


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class ExecRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    timeout_s: float = Field(default=5.0, gt=0, le=MAX_TIMEOUT_S)


class ExecResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int | None
    timed_out: bool
    truncated: bool
    duration_ms: int


app = FastAPI(title="Arena sandbox", version=__version__, docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@app.post("/exec")
async def run_code(request: ExecRequest) -> ExecResponse:
    result = await execute(request.code, ExecLimits(timeout_s=request.timeout_s), FIXTURES_DIR)
    return ExecResponse(
        stdout=result.stdout,
        stderr=result.stderr,
        exit_code=result.exit_code,
        timed_out=result.timed_out,
        truncated=result.truncated,
        duration_ms=result.duration_ms,
    )


class MermaidRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_CHARS)


class MermaidResponse(BaseModel):
    valid: bool
    error: str | None


@app.post("/mermaid/parse")
async def check_mermaid(request: MermaidRequest) -> MermaidResponse:
    """Says whether the text parses as a Mermaid diagram. Nothing is rendered.

    If the parser itself fails, the answer is 503, never "invalid": a caller
    must not score a diagram on a verdict that was not given.
    """
    try:
        verdict = await parse_mermaid(request.code)
    except MermaidUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return MermaidResponse(valid=verdict.valid, error=verdict.error)
