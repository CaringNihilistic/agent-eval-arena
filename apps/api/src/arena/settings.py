"""Runtime configuration, read from environment variables prefixed with ARENA_."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ARENA_", extra="ignore")

    cors_origins: list[str] = ["http://localhost:3100"]
    sandbox_url: str | None = None
    sandbox_health_timeout_s: float = 2.0
    schema_path: Path = REPO_ROOT / "packages" / "schema" / "trace-event.schema.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
