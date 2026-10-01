"""Runs one config on one task and returns the trace."""

import time
from dataclasses import dataclass, field

from ulid import ULID

from arena.backends.base import AgentBackend, BackendUnavailableError
from arena.backends.litellm_loop import LiteLLMLoopBackend
from arena.config import AgentConfig, Task
from arena.events import Emitter, Event, Sink
from arena.llm import LLMClient
from arena.pricing import PricingTable, assert_runnable, default_pricing
from arena.run_context import RunContext, RunLimits, StopReason
from arena.settings import Settings
from arena.tools.registry import build_tools


@dataclass
class RunResult:
    run_id: str
    stop_reason: StopReason
    final_answer: str | None
    steps: int
    tool_calls: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    reference_cost_usd: float
    # Active time: model and tool latency.
    latency_ms: int
    # Start to finish, including any waiting.
    wall_clock_ms: int
    # True when a rate limit cut the run short: re-run it, do not score it.
    abandoned: bool
    events: list[Event] = field(default_factory=list)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


def select_backend(config: AgentConfig, llm: LLMClient) -> AgentBackend:
    if config.backend == "litellm":
        return LiteLLMLoopBackend(llm)
    # TODO(phase-2b): the Claude Agent SDK backend plugs in here.
    raise BackendUnavailableError(
        f"Config {config.name!r} uses the {config.backend!r} backend, which is not built yet."
    )


async def run_agent(
    config: AgentConfig,
    task: Task,
    *,
    llm: LLMClient,
    settings: Settings,
    limits: RunLimits | None = None,
    pricing: PricingTable | None = None,
    sink: Sink | None = None,
) -> RunResult:
    """Run `config` on `task`. Raises ModelNotAllowedError before any model call
    if the model is not marked free or subscription."""
    entry = assert_runnable(
        pricing or default_pricing(),
        config.model,
        config.backend,
        allow_paid=settings.allow_paid_models,
    )
    backend = select_backend(config, llm)

    events: list[Event] = []

    def collect(event: Event) -> None:
        events.append(event)
        if sink is not None:
            sink(event)

    run_id = str(ULID())
    started = time.monotonic()
    ctx = RunContext(
        config=config,
        task=task,
        limits=limits or RunLimits(),
        emitter=Emitter(run_id, collect),
        pricing=entry,
        tools=build_tools(config.enabled_tools, settings),
    )
    ctx.emitter.emit("run_started", {"config": config.snapshot(), "task_id": task.id})
    ctx.messages.extend(
        [
            {"role": "system", "content": config.system_prompt},
            {"role": "user", "content": task.prompt},
        ]
    )

    try:
        await backend.run(ctx)
    except Exception as error:  # A backend bug still ends the run with a complete trace.
        ctx.error(f"the agent loop failed: {type(error).__name__}: {error}", recoverable=False)
        ctx.stop("error")
    stop_reason: StopReason = ctx.stop_reason or "error"

    ctx.emitter.emit(
        "run_finished",
        {
            "final_answer": ctx.final_answer,
            "cost_usd": ctx.cost_usd,
            "reference_cost_usd": ctx.reference_cost_usd,
            "total_tokens": ctx.total_tokens,
            "steps": ctx.steps,
            "latency_ms": ctx.active_ms,
            "stop_reason": stop_reason,
        },
    )
    return RunResult(
        run_id=run_id,
        stop_reason=stop_reason,
        final_answer=ctx.final_answer,
        steps=ctx.steps,
        tool_calls=ctx.tool_calls,
        prompt_tokens=ctx.prompt_tokens,
        completion_tokens=ctx.completion_tokens,
        cost_usd=ctx.cost_usd,
        reference_cost_usd=ctx.reference_cost_usd,
        latency_ms=ctx.active_ms,
        wall_clock_ms=int((time.monotonic() - started) * 1000),
        abandoned=ctx.abandoned,
        events=events,
    )
