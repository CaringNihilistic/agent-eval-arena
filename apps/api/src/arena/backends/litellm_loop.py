"""Our own agent loop: a LangGraph graph whose nodes call the model through LiteLLM.

    start -> llm -> tools -> llm -> ... -> end

`llm` is the plan step: the model decides what to do. `tools` is act and observe:
the calls run and their results go back into the conversation.
"""

import asyncio
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from arena.llm import (
    InvalidToolCallError,
    LLMCallError,
    LLMClient,
    ProviderUnavailableError,
    ToolCallRequest,
)
from arena.run_context import RunContext, StopReason
from arena.tools.registry import SUBMIT_ANSWER, tool_schemas


class LoopState(TypedDict):
    # Tool calls the model asked for that have not run yet.
    pending: list[ToolCallRequest]


Route = Literal["continue", "finish"]

# A model that repeats an unusable tool call this many times in a row is not going
# to recover, and each attempt still counts against the provider's rate limit.
MAX_REJECTED_TOOL_CALLS = 3


class LiteLLMLoopBackend:
    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(self, ctx: RunContext) -> None:
        schemas = tool_schemas(ctx.tools)

        async def llm_node(state: LoopState) -> LoopState:
            return {"pending": await self._plan(ctx, schemas)}

        async def tools_node(state: LoopState) -> LoopState:
            await _act(ctx, state["pending"])
            return {"pending": []}

        def route(state: LoopState) -> Route:
            return "finish" if ctx.stopped else "continue"

        graph = StateGraph(LoopState)
        graph.add_node("llm", llm_node)
        graph.add_node("tools", tools_node)
        graph.add_edge(START, "llm")
        graph.add_conditional_edges("llm", route, {"continue": "tools", "finish": END})
        graph.add_conditional_edges("tools", route, {"continue": "llm", "finish": END})

        # Two graph steps per agent step, plus headroom; max_steps is the real limit.
        recursion_limit = 2 * ctx.config.max_steps + 10
        await graph.compile().ainvoke({"pending": []}, config={"recursion_limit": recursion_limit})

    async def _plan(
        self, ctx: RunContext, schemas: list[dict[str, object]]
    ) -> list[ToolCallRequest]:
        """One model call. Returns the tool calls to run, or stops the run."""
        if (reason := ctx.limit_reached()) is not None:
            ctx.stop(reason)
            return []
        if ctx.steps >= ctx.config.max_steps:
            ctx.stop("max_steps")
            return []

        ctx.start_step()
        remaining_tokens = ctx.limits.max_total_tokens - ctx.total_tokens
        try:
            async with asyncio.timeout(ctx.remaining_time_s):
                response = await self._llm.complete(
                    model=ctx.config.model,
                    messages=ctx.messages,
                    tools=schemas,
                    temperature=ctx.config.temperature,
                    max_tokens=min(ctx.limits.max_completion_tokens, remaining_tokens),
                )
        except TimeoutError:
            ctx.error("the model call ran past the run's time limit", recoverable=False)
            return _end_step(ctx, "timeout")
        except ProviderUnavailableError as error:
            ctx.abandoned = True
            ctx.error(f"the provider could not serve the call: {error}", recoverable=True)
            return _end_step(ctx, "error")
        except InvalidToolCallError as error:
            # The provider discarded the response. Tell the model, as we would for
            # any other unusable tool call, and let it try again. This uses a step.
            ctx.add_active_time(error.latency_ms)
            ctx.consecutive_rejections += 1
            if ctx.consecutive_rejections >= MAX_REJECTED_TOOL_CALLS:
                ctx.error(
                    f"the model made {MAX_REJECTED_TOOL_CALLS} unusable tool calls in a row: "
                    f"{error.provider_message}",
                    recoverable=False,
                )
                return _end_step(ctx, "error")
            ctx.error(
                f"the provider rejected the model's tool call: {error.provider_message}",
                recoverable=True,
            )
            ctx.messages.append({"role": "user", "content": _rejection_notice(ctx, error)})
            ctx.finish_step()
            return []
        except LLMCallError as error:
            ctx.error(f"the model call failed: {error}", recoverable=False)
            return _end_step(ctx, "error")

        ctx.record_llm_call(response)
        ctx.messages.append(response.message)

        if not response.tool_calls:
            answer = (response.content or "").strip()
            if answer:
                ctx.final_answer = answer
                return _end_step(ctx, "answered")
            ctx.error("the model returned neither an answer nor a tool call", recoverable=False)
            return _end_step(ctx, "error")

        # An answer already given outranks a budget that this same call used up.
        submits = any(call.name == SUBMIT_ANSWER for call in response.tool_calls)
        if not submits and (reason := ctx.limit_reached()) is not None:
            return _end_step(ctx, reason)
        return response.tool_calls


def _end_step(ctx: RunContext, reason: StopReason) -> list[ToolCallRequest]:
    ctx.finish_step()
    ctx.stop(reason)
    return []


def _rejection_notice(ctx: RunContext, error: InvalidToolCallError) -> str:
    names = ", ".join([*ctx.tools, SUBMIT_ANSWER])
    return (
        f"Your last response was rejected and not used: {error.provider_message}. "
        f"The only tools that exist are: {names}. Call one of them, with its arguments "
        "as a JSON object."
    )


async def _act(ctx: RunContext, calls: list[ToolCallRequest]) -> None:
    """Run the requested tools in order and put each result into the conversation."""
    if not calls:
        # The step was already closed without tool calls; go back to the model.
        return
    for call in calls:
        content = await ctx.execute_tool(call)
        ctx.messages.append({"role": "tool", "tool_call_id": call.call_id, "content": content})
    ctx.finish_step()
    if ctx.final_answer is not None:
        ctx.stop("answered")
    elif (reason := ctx.limit_reached()) is not None:
        ctx.stop(reason)
