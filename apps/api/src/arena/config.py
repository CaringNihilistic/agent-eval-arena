"""Agent configs and tasks, loaded from YAML files in the repository."""

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from arena.pricing import Backend

ToolName = Literal["calculator", "python_exec", "search_docs", "read_file"]
Category = Literal["math", "data_analysis", "multi_hop", "tool_trap"]
ScorerType = Literal["exact", "numeric_tolerance", "regex", "python_check", "llm_judge"]

# Folders under tasks/ that hold data for tasks, not task definitions.
NON_TASK_DIRS = {"fixtures", "corpus", "checkers"}


class AgentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    version: int = Field(ge=1)
    display_name: str
    backend: Backend
    model: str
    provider: str
    model_family: str
    system_prompt: str
    enabled_tools: list[ToolName]
    max_steps: int = Field(ge=1)
    temperature: float | None = None

    @property
    def id(self) -> str:
        return f"{self.name}@v{self.version}"

    def snapshot(self) -> dict[str, Any]:
        """The shape the trace schema calls ConfigSnapshot."""
        return {
            "id": self.id,
            "family_id": self.name,
            "version": self.version,
            "display_name": self.display_name,
            "backend": self.backend,
            "model": self.model,
            "provider": self.provider,
            "model_family": self.model_family,
            "system_prompt": self.system_prompt,
            "enabled_tools": list(self.enabled_tools),
            "max_steps": self.max_steps,
            "temperature": self.temperature,
        }


class Task(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    title: str
    category: Category
    difficulty: Literal["easy", "medium", "hard"]
    prompt: str
    required_tools: list[ToolName]
    scorer_type: ScorerType
    scorer_config: dict[str, Any]


def _read_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def load_config(configs_dir: Path, name: str) -> AgentConfig:
    path = configs_dir / f"{name}.yaml"
    if not path.is_file():
        known = ", ".join(sorted(p.stem for p in configs_dir.glob("*.yaml"))) or "none"
        raise FileNotFoundError(f"No config named {name!r}. Known configs: {known}")
    data = _read_yaml(path)
    prompt_file = data.pop("system_prompt_file", None)
    if prompt_file is not None:
        data["system_prompt"] = (configs_dir / prompt_file).read_text(encoding="utf-8").strip()
    return AgentConfig.model_validate(data)


def load_configs(configs_dir: Path) -> dict[str, AgentConfig]:
    return {p.stem: load_config(configs_dir, p.stem) for p in sorted(configs_dir.glob("*.yaml"))}


def load_tasks(tasks_dir: Path) -> dict[str, Task]:
    tasks: dict[str, Task] = {}
    for path in sorted(tasks_dir.rglob("*.yaml")):
        if NON_TASK_DIRS.intersection(path.relative_to(tasks_dir).parts):
            continue
        task = Task.model_validate(_read_yaml(path))
        if task.id in tasks:
            raise ValueError(f"Duplicate task id {task.id!r} in {path}")
        tasks[task.id] = task
    return tasks
