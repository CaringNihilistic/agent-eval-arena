# GENERATED from packages/schema/trace-event.schema.json.
# Do not edit by hand; run `pnpm schema:gen`.

from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel


class ConstraintCheck(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: str
    passed: bool
    detail: str


class ConfigSnapshot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    family_id: str
    version: Annotated[int, Field(ge=1)]
    display_name: str
    backend: Annotated[
        Literal["litellm", "agent_sdk"],
        Field(
            description="Which agent loop ran the config: our LangGraph loop over LiteLLM, or Claude Code's loop through the Claude Agent SDK.",
            title="AgentBackend",
        ),
    ]
    model: str
    provider: str
    model_family: str
    system_prompt: str
    enabled_tools: list[Literal["calculator", "python_exec", "search_docs", "read_file"]]
    max_steps: Annotated[int, Field(ge=1)]
    temperature: Annotated[
        float | None, Field(description="Null means the parameter is omitted from model requests.")
    ]


class MessagePreview(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    role: Annotated[Literal["system", "user", "assistant", "tool"], Field(title="MessageRole")]
    content: str
    truncated: bool


class ToolInvocation(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    call_id: str
    tool: Annotated[
        str,
        Field(
            description="Name as the model wrote it. Not restricted to ToolName: it can be the submit_answer control tool or a name that does not exist."
        ),
    ]
    arguments: dict[str, Any]


class LlmOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    content: str | None
    thinking: Annotated[
        str | None,
        Field(
            description="The model's thinking for this call, as the provider returned it. Null when the model did not think, and always null in the blind view."
        ),
    ]
    tool_calls: list[ToolInvocation]
    truncated: bool


class RunStartedPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    config: Annotated[ConfigSnapshot | None, Field(description="Null in the blind view.")]
    task_id: str


class StepStartedPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    step: Annotated[int, Field(ge=1)]


class LlmCallPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    step: Annotated[int, Field(ge=1)]
    model: Annotated[str | None, Field(description="Null in the blind view.")]
    input_upto: Annotated[
        int,
        Field(
            description="The model saw conversation messages 0 up to, not including, this index.",
            ge=0,
        ),
    ]
    input_preview: Annotated[
        list[MessagePreview],
        Field(description="Messages added to the conversation since the previous model call."),
    ]
    output: LlmOutput
    prompt_tokens: Annotated[
        int | None,
        Field(
            description="All input tokens, including any read from or written to the provider's prompt cache. Null in the blind view.",
            ge=0,
        ),
    ]
    completion_tokens: Annotated[int | None, Field(description="Null in the blind view.", ge=0)]
    cache_read_tokens: Annotated[
        int | None,
        Field(
            description="Input tokens served from the provider's prompt cache, when the provider reports it. Null when not reported, and in the blind view.",
            ge=0,
        ),
    ]
    cache_write_tokens: Annotated[
        int | None,
        Field(
            description="Input tokens written to the provider's prompt cache, when the provider reports it. Null when not reported, and in the blind view.",
            ge=0,
        ),
    ]
    cost_usd: Annotated[
        float | None,
        Field(
            description="What was actually charged. Zero on free tiers and subscriptions. Null in the blind view.",
            ge=0.0,
        ),
    ]
    reference_cost_usd: Annotated[
        float | None,
        Field(
            description="What the same tokens would cost at the provider's paid list price. Null in the blind view.",
            ge=0.0,
        ),
    ]
    latency_ms: Annotated[
        int | None, Field(description="Null in the blind view: speed identifies the model.", ge=0)
    ]


class ToolCallPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    step: Annotated[int, Field(ge=1)]
    call_id: str
    tool: str
    arguments: dict[str, Any]


class ToolResultPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    step: Annotated[int, Field(ge=1)]
    call_id: str
    tool: str
    output: Annotated[str, Field(description="Truncated for display.")]
    truncated: bool
    success: bool
    latency_ms: Annotated[int | None, Field(description="Null in the blind view.", ge=0)]
    error: str | None


class StepFinishedPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    step: Annotated[int, Field(ge=1)]
    total_tokens: Annotated[
        int | None, Field(description="Cumulative for the run. Null in the blind view.", ge=0)
    ]
    cost_usd: Annotated[
        float | None,
        Field(
            description="Actually charged, cumulative for the run. Null in the blind view.", ge=0.0
        ),
    ]
    reference_cost_usd: Annotated[
        float | None,
        Field(
            description="At paid list price, cumulative for the run. Null in the blind view.",
            ge=0.0,
        ),
    ]


class RunFinishedPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    final_answer: str | None
    cost_usd: Annotated[
        float | None, Field(description="Actually charged. Null in the blind view.", ge=0.0)
    ]
    reference_cost_usd: Annotated[
        float | None, Field(description="At paid list price. Null in the blind view.", ge=0.0)
    ]
    total_tokens: Annotated[int | None, Field(description="Null in the blind view.", ge=0)]
    steps: Annotated[int, Field(ge=0)]
    latency_ms: Annotated[
        int | None,
        Field(
            description="Active time: the sum of model-call and tool-call latencies. Waits for rate limits are excluded. Null in the blind view.",
            ge=0,
        ),
    ]
    stop_reason: Annotated[
        Literal["answered", "max_steps", "max_tokens", "max_cost", "timeout", "error"] | None,
        Field(description="Null in the blind view when the run stopped at a token or cost limit."),
    ]


class ScoreComputedPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    passed: Annotated[
        bool | None,
        Field(description="Null for open-ended tasks, where there is no right answer to check."),
    ]
    score: Annotated[float, Field(ge=0.0, le=1.0)]
    scorer_type: Annotated[
        Literal["exact", "numeric_tolerance", "regex", "python_check", "llm_judge", "constraints"],
        Field(
            description="How a run was scored. `constraints` checks an open-ended answer against the task's stated limits; it says nothing about quality.",
            title="ScorerType",
        ),
    ]
    explanation: str
    checks: Annotated[
        list[ConstraintCheck], Field(description="Empty for tasks with a right answer.")
    ]


class ErrorPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    message: str
    recoverable: bool
    step: Annotated[int | None, Field(ge=1)]


class RunStartedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["run_started"]
    timestamp: AwareDatetime
    redacted: bool
    payload: RunStartedPayload


class StepStartedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["step_started"]
    timestamp: AwareDatetime
    redacted: bool
    payload: StepStartedPayload


class LlmCallEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["llm_call"]
    timestamp: AwareDatetime
    redacted: bool
    payload: LlmCallPayload


class ToolCallEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["tool_call"]
    timestamp: AwareDatetime
    redacted: bool
    payload: ToolCallPayload


class ToolResultEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["tool_result"]
    timestamp: AwareDatetime
    redacted: bool
    payload: ToolResultPayload


class StepFinishedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["step_finished"]
    timestamp: AwareDatetime
    redacted: bool
    payload: StepFinishedPayload


class RunFinishedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["run_finished"]
    timestamp: AwareDatetime
    redacted: bool
    payload: RunFinishedPayload


class ScoreComputedEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["score_computed"]
    timestamp: AwareDatetime
    redacted: bool
    payload: ScoreComputedPayload


class ErrorEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: str
    side: Annotated[
        Literal["left", "right"] | None,
        Field(
            description="Which pane of a match the event belongs to. Null when a run is served outside a match.",
            title="Side",
        ),
    ]
    seq: Annotated[int, Field(ge=0)]
    type: Literal["error"]
    timestamp: AwareDatetime
    redacted: bool
    payload: ErrorPayload


class TraceEvent(
    RootModel[
        RunStartedEvent
        | StepStartedEvent
        | LlmCallEvent
        | ToolCallEvent
        | ToolResultEvent
        | StepFinishedEvent
        | RunFinishedEvent
        | ScoreComputedEvent
        | ErrorEvent
    ]
):
    root: Annotated[
        RunStartedEvent
        | StepStartedEvent
        | LlmCallEvent
        | ToolCallEvent
        | ToolResultEvent
        | StepFinishedEvent
        | RunFinishedEvent
        | ScoreComputedEvent
        | ErrorEvent,
        Field(
            description="One structured event in an agent run. This file is the only definition of the trace format; TypeScript and Pydantic types are generated from it.",
            discriminator="type",
            title="TraceEvent",
        ),
    ]
