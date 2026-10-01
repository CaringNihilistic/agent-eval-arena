"""Liveness endpoint. Also reports whether the sandbox service is reachable."""

from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from arena import __version__
from arena.settings import Settings, get_settings

router = APIRouter()

SandboxStatus = Literal["ok", "unreachable", "not_configured"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    sandbox: SandboxStatus


async def check_sandbox(settings: Settings) -> SandboxStatus:
    if settings.sandbox_url is None:
        return "not_configured"
    try:
        async with httpx.AsyncClient(timeout=settings.sandbox_health_timeout_s) as client:
            response = await client.get(f"{settings.sandbox_url}/health")
    except httpx.HTTPError:
        return "unreachable"
    return "ok" if response.status_code == 200 else "unreachable"


@router.get("/health")
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(status="ok", version=__version__, sandbox=await check_sandbox(settings))
