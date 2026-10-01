"""Sandbox HTTP service. Phase 1 exposes health only; code execution arrives in Phase 2."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from sandbox import __version__


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


app = FastAPI(title="Arena sandbox", version=__version__, docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)
