"""The seam between the shared run core and an agent loop.

A backend owns the loop: asking the model what to do and feeding it results.
Everything else (limits, tools, cost, events) lives in RunContext, so a second
loop can be added without duplicating any of it.
"""

from typing import Protocol

from arena.run_context import RunContext


class AgentBackend(Protocol):
    async def run(self, ctx: RunContext) -> None:
        """Drive the model until `ctx.stop_reason` is set.

        The conversation is already seeded in `ctx.messages`. The backend must:
        - call `ctx.start_step()` before each model call and `ctx.finish_step()` after
          the step's tools have run;
        - report every model response with `ctx.record_llm_call()`;
        - run every tool through `ctx.execute_tool()`;
        - stop with `ctx.stop(reason)` when the model answers or a limit is reached.
        """
        ...


class BackendUnavailableError(Exception):
    """The config names a backend this build cannot run."""
