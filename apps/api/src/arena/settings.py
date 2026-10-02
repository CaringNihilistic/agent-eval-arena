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

    configs_dir: Path = REPO_ROOT / "configs"
    tasks_dir: Path = REPO_ROOT / "tasks"
    fixtures_dir: Path = REPO_ROOT / "tasks" / "fixtures"
    corpus_dir: Path = REPO_ROOT / "tasks" / "corpus"
    # Recorded runs and their index files. Committed; the web app reads them.
    recordings_dir: Path = REPO_ROOT / "data" / "recordings"

    # Off by default. The project must cost $0, so a model billed per token is
    # refused unless this is set on purpose.
    allow_paid_models: bool = False

    # Only for llm_judge tasks, of which the recorded bank has none. The judge's
    # family must differ from every contestant's.
    judge_model: str | None = None
    judge_model_family: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
