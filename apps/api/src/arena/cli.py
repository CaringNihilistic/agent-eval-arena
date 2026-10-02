"""The `arena` command line."""

import asyncio
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import typer

from arena.backends.base import BackendUnavailableError
from arena.backends.claude_auth import SubscriptionAuthError
from arena.config import AgentConfig, Task, load_bank, load_config, load_configs, load_tasks
from arena.evaluation import HEADER, EvalRow, evaluate, format_row, summarise
from arena.events import Event
from arena.llm import LiteLLMClient
from arena.pricing import ModelNotAllowedError
from arena.recording import build_index, record
from arena.runner import RunResult, run_agent
from arena.settings import get_settings

app = typer.Typer(no_args_is_help=True, add_completion=False)

# The environment variable LiteLLM reads for each provider.
PROVIDER_KEYS = {"gemini": "GEMINI_API_KEY", "groq": "GROQ_API_KEY"}


def _short(value: Any, limit: int = 110) -> str:  # noqa: ANN401
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def describe(event: Event) -> str:
    """One readable line per trace event."""
    payload = event["payload"]
    match event["type"]:
        case "run_started":
            config = payload["config"]
            detail = f"{config['id']} ({config['model']}) on {payload['task_id']}"
        case "step_started":
            detail = f"step {payload['step']}"
        case "llm_call":
            calls = ", ".join(c["tool"] for c in payload["output"]["tool_calls"]) or "no tool call"
            detail = (
                f"{payload['prompt_tokens']} in / {payload['completion_tokens']} out tokens, "
                f"{payload['latency_ms']} ms, ${payload['cost_usd']:.4f} actual, "
                f"${payload['reference_cost_usd']:.6f} at paid rates -> {calls}"
            )
            if payload["output"]["content"]:
                detail += f"\n       says: {_short(payload['output']['content'])}"
        case "tool_call":
            detail = f"{payload['tool']}({_short(payload['arguments'])})"
        case "tool_result":
            status = "ok" if payload["success"] else "FAILED"
            detail = f"{payload['tool']} {status} in {payload['latency_ms']} ms: " + _short(
                payload["output"]
            )
        case "step_finished":
            detail = f"step {payload['step']} done, {payload['total_tokens']} tokens so far"
        case "run_finished":
            detail = (
                f"{payload['stop_reason']}, answer={payload['final_answer']!r}, "
                f"{payload['steps']} steps, {payload['total_tokens']} tokens, "
                f"{payload['latency_ms']} ms active, ${payload['cost_usd']:.4f} actual, "
                f"${payload['reference_cost_usd']:.6f} at paid rates"
            )
        case "score_computed":
            verdict = {True: "PASS", False: "FAIL", None: "CONSTRAINTS"}[payload["passed"]]
            detail = f"{verdict} ({payload['scorer_type']}): {payload['explanation']}"
        case "error":
            detail = payload["message"]
        case _:
            detail = _short(payload)
    return f"[{event['seq']:02d}] {event['type']:<14} {detail}"


@app.command()
def run(
    config: Annotated[str, typer.Option(help="Config name, for example claude-haiku-full")],
    task: Annotated[str, typer.Option(help="Task id, for example dev-math-01")],
    allow_paid: Annotated[
        bool, typer.Option("--allow-paid", help="Allow a model billed per token. Costs money.")
    ] = False,
    as_json: Annotated[bool, typer.Option("--json", help="Print raw events, one per line")] = False,
    dump_raw: Annotated[
        Path | None,
        typer.Option(
            help="Also write raw provider traffic to this folder: responses for the LiteLLM "
            "backend, request and response bodies for the Claude backend"
        ),
    ] = None,
) -> None:
    """Run one config on one task and print the trace."""
    settings = get_settings()
    if allow_paid:
        settings = settings.model_copy(update={"allow_paid_models": True})
        typer.echo("WARNING: --allow-paid is set. This run can cost money.", err=True)

    try:
        agent_config = load_config(settings.configs_dir, config)
    except FileNotFoundError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(2) from error
    tasks = load_tasks(settings.tasks_dir)
    if task not in tasks:
        typer.echo(f"No task with id {task!r}. Known tasks: {', '.join(sorted(tasks))}", err=True)
        raise typer.Exit(2)

    _check_provider_key(agent_config)

    def show(event: Event) -> None:
        typer.echo(json.dumps(event) if as_json else describe(event))

    llm = LiteLLMClient(dump_dir=dump_raw) if agent_config.backend == "litellm" else None
    try:
        result: RunResult = asyncio.run(
            run_agent(
                agent_config,
                tasks[task],
                llm=llm,
                settings=settings,
                sink=show,
                raw_request_dir=dump_raw,
            )
        )
    except (ModelNotAllowedError, BackendUnavailableError, SubscriptionAuthError) as error:
        typer.echo(f"Refused: {error}", err=True)
        raise typer.Exit(3) from error

    typer.echo(f"wall clock: {result.wall_clock_ms} ms", err=True)
    for key in ("harness_version", "account_models"):
        if result.backend_info.get(key):
            typer.echo(f"{key}: {result.backend_info[key]}", err=True)
    estimate = result.backend_info.get("sdk_cost_estimate_usd")
    if estimate is not None:
        typer.echo(
            f"Claude Agent SDK's own cost estimate: ${estimate:.6f} "
            f"(our table: ${result.reference_cost_usd:.6f}); nothing was charged",
            err=True,
        )
    if result.stop_reason == "error" and not result.abandoned:
        raise typer.Exit(1)
    if result.abandoned:
        typer.echo(
            "The provider could not serve this run (rate limit or outage). "
            "It should be re-run, not scored.",
            err=True,
        )
        raise typer.Exit(4)


def _check_provider_key(agent_config: AgentConfig) -> None:
    key_name = PROVIDER_KEYS.get(agent_config.provider)
    if key_name is not None and not os.environ.get(key_name):
        typer.echo(
            f"{key_name} is not set. Add it to .env (see .env.example) and restart the api "
            "container.",
            err=True,
        )
        raise typer.Exit(2)


@app.command(name="eval")
def eval_config(
    config: Annotated[str, typer.Option(help="Config name, for example claude-haiku-full")],
    category: Annotated[
        str | None,
        typer.Option(
            help="Only this category: writing, diagram, explanation, tech_stack, code, agent"
        ),
    ] = None,
    task: Annotated[list[str] | None, typer.Option(help="Only these task ids (repeatable)")] = None,
    include_dev: Annotated[
        bool, typer.Option("--include-dev", help="Also run the development tasks")
    ] = False,
    delay: Annotated[
        float, typer.Option(help="Seconds to wait between runs, for free-tier rate limits")
    ] = 0.0,
) -> None:
    """Run one config across the task bank and print a results table.

    Every run is a real model call on a free tier or the subscription.
    """
    settings = get_settings()
    try:
        agent_config = load_config(settings.configs_dir, config)
    except FileNotFoundError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(2) from error
    available = load_tasks(settings.tasks_dir) if include_dev else load_bank(settings.tasks_dir)
    chosen: list[Task] = [
        item
        for item in available.values()
        if (category is None or item.category == category) and (not task or item.id in task)
    ]
    if not chosen:
        typer.echo("No task matches that selection.", err=True)
        raise typer.Exit(2)
    _check_provider_key(agent_config)
    llm = LiteLLMClient() if agent_config.backend == "litellm" else None

    async def run_one(item: Task) -> RunResult:
        return await run_agent(agent_config, item, llm=llm, settings=settings)

    typer.echo(f"{agent_config.id} ({agent_config.model}) on {len(chosen)} tasks")
    typer.echo(HEADER)
    try:
        rows = asyncio.run(
            evaluate(chosen, run_one, delay_s=delay, on_row=lambda row: typer.echo(format_row(row)))
        )
    except (ModelNotAllowedError, BackendUnavailableError, SubscriptionAuthError) as error:
        typer.echo(f"Refused: {error}", err=True)
        raise typer.Exit(3) from error
    for line in summarise(rows):
        typer.echo(line)


@app.command(name="record")
def record_bank(
    config: Annotated[
        list[str] | None, typer.Option(help="Only these configs (repeatable). Default: all")
    ] = None,
    task: Annotated[list[str] | None, typer.Option(help="Only these task ids (repeatable)")] = None,
    dump_raw: Annotated[
        Path | None,
        typer.Option(help="Write the raw request and response bodies of the first run here"),
    ] = None,
    index_only: Annotated[
        bool, typer.Option("--index-only", help="Rebuild the index files and run nothing")
    ] = False,
) -> None:
    """Record every missing (config, task) run into data/recordings/, then rebuild the index.

    Every run is a real model call on the subscription. Runs already recorded are
    skipped, so the command can be stopped and started again.
    """
    settings = get_settings()
    out_dir = settings.recordings_dir
    bank = load_bank(settings.tasks_dir)
    if index_only:
        runs, matches = build_index(out_dir, list(bank.values()))
        typer.echo(f"index rebuilt: {runs} runs, {matches} matches")
        return
    configs = load_configs(settings.configs_dir)
    unknown = [name for name in config or [] if name not in configs]
    if unknown:
        typer.echo(f"No config named {unknown[0]!r}.", err=True)
        raise typer.Exit(2)
    chosen_configs = [configs[name] for name in (config or configs)]
    chosen_tasks = [item for item in bank.values() if not task or item.id in task]
    if not chosen_tasks:
        typer.echo("No task matches that selection.", err=True)
        raise typer.Exit(2)
    raw_dirs = [dump_raw] if dump_raw is not None else []

    async def run_one(agent_config: AgentConfig, item: Task) -> RunResult:
        llm = LiteLLMClient() if agent_config.backend == "litellm" else None
        # Only the first run of this invocation is captured.
        raw = raw_dirs.pop() if raw_dirs else None
        return await run_agent(agent_config, item, llm=llm, settings=settings, raw_request_dir=raw)

    def show(agent_config: AgentConfig, item: Task, result: RunResult) -> None:
        typer.echo(f"{agent_config.name:<20} {format_row(EvalRow(item, result))}")

    typer.echo(f"{'config':<20} {HEADER}")
    try:
        report = asyncio.run(record(chosen_configs, chosen_tasks, run_one, out_dir, on_run=show))
    except (ModelNotAllowedError, BackendUnavailableError, SubscriptionAuthError) as error:
        typer.echo(f"Refused: {error}", err=True)
        raise typer.Exit(3) from error
    runs, matches = build_index(out_dir, list(bank.values()))
    typer.echo(
        f"recorded {len(report.recorded)}, already had {report.skipped}, "
        f"still missing {report.remaining}; index: {runs} runs, {matches} matches"
    )
    if report.cause == "usage_limit":
        resets = (
            datetime.fromtimestamp(report.resets_at, UTC).isoformat(timespec="minutes")
            if report.resets_at
            else "an unknown time"
        )
        typer.echo(
            f"Stopped at the subscription's usage limit ({report.detail}). It resets at "
            f"{resets}. Run the same command again after that.",
            err=True,
        )
        raise typer.Exit(5)
    if report.cause != "done":
        typer.echo(
            f"Stopped: {report.cause} ({report.detail}). Nothing was written for it.", err=True
        )
        raise typer.Exit(6)


@app.command(name="list")
def list_items() -> None:
    """List the configs and tasks that are available."""
    settings = get_settings()
    typer.echo("Configs:")
    for name, agent_config in load_configs(settings.configs_dir).items():
        tools = ", ".join(agent_config.enabled_tools)
        typer.echo(f"  {name:<22} {agent_config.model:<28} tools: {tools}")
    typer.echo("Tasks:")
    for task_id, item in load_tasks(settings.tasks_dir).items():
        typer.echo(f"  {task_id:<22} {item.category:<14} {item.title}")


if __name__ == "__main__":
    app()
