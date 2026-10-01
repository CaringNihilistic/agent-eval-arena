"""The JSON Schema and the generated Pydantic models must agree on what a valid event is."""

import json
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import TypeAdapter, ValidationError

from arena.schema_gen import TraceEvent
from arena.settings import get_settings

ENVELOPE: dict[str, Any] = {
    "run_id": "run_01",
    "side": "left",
    "seq": 0,
    "timestamp": "2026-10-01T12:00:00Z",
    "redacted": False,
}

CONFIG: dict[str, Any] = {
    "id": "cfg_01",
    "family_id": "fam_01",
    "version": 1,
    "display_name": "strong",
    "backend": "litellm",
    "model": "provider/model",
    "provider": "provider",
    "model_family": "family",
    "system_prompt": "Solve the task.",
    "enabled_tools": ["calculator", "python_exec"],
    "max_steps": 8,
    "temperature": None,
}

VALID_PAYLOADS: dict[str, dict[str, Any]] = {
    "run_started": {"config": CONFIG, "task_id": "math-01"},
    "step_started": {"step": 1},
    "llm_call": {
        "step": 1,
        "model": "provider/model",
        "input_upto": 2,
        "input_preview": [{"role": "user", "content": "What is 2 + 2?", "truncated": False}],
        "output": {
            "content": None,
            "tool_calls": [
                {"call_id": "c1", "tool": "calculator", "arguments": {"expression": "2+2"}}
            ],
            "truncated": False,
        },
        "prompt_tokens": 120,
        "completion_tokens": 18,
        "cache_read_tokens": None,
        "cache_write_tokens": None,
        "cost_usd": 0.0,
        "reference_cost_usd": 0.00084,
        "latency_ms": 900,
    },
    "tool_call": {
        "step": 1,
        "call_id": "c1",
        "tool": "calculator",
        "arguments": {"expression": "2+2"},
    },
    "tool_result": {
        "step": 1,
        "call_id": "c1",
        "tool": "calculator",
        "output": "4",
        "truncated": False,
        "success": True,
        "latency_ms": 3,
        "error": None,
    },
    "step_finished": {
        "step": 1,
        "total_tokens": 138,
        "cost_usd": 0.0,
        "reference_cost_usd": 0.00084,
    },
    "run_finished": {
        "final_answer": "4",
        "cost_usd": 0.0,
        "reference_cost_usd": 0.0017,
        "total_tokens": 290,
        "steps": 2,
        "latency_ms": 2100,
        "stop_reason": "answered",
    },
    "score_computed": {
        "passed": True,
        "score": 1.0,
        "scorer_type": "exact",
        "explanation": "Matches the expected answer.",
    },
    "error": {"message": "tool timed out", "recoverable": True, "step": 1},
}

# The blind view nulls these fields; the result must still be a valid event.
BLIND_OVERRIDES: dict[str, dict[str, Any]] = {
    "run_started": {"config": None},
    "llm_call": {
        "model": None,
        "prompt_tokens": None,
        "completion_tokens": None,
        "cache_read_tokens": None,
        "cache_write_tokens": None,
        "cost_usd": None,
        "reference_cost_usd": None,
    },
    "step_finished": {"total_tokens": None, "cost_usd": None, "reference_cost_usd": None},
    "run_finished": {
        "cost_usd": None,
        "reference_cost_usd": None,
        "total_tokens": None,
        "stop_reason": None,
    },
}

ADAPTER: TypeAdapter[TraceEvent] = TypeAdapter(TraceEvent)


@pytest.fixture(scope="module")
def validator() -> Draft202012Validator:
    schema = json.loads(get_settings().schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def event(event_type: str, **payload_overrides: object) -> dict[str, Any]:
    payload = {**VALID_PAYLOADS[event_type], **payload_overrides}
    return {**ENVELOPE, "type": event_type, "payload": payload}


def accepted_by_schema(validator: Draft202012Validator, candidate: dict[str, Any]) -> bool:
    return validator.is_valid(candidate)


def accepted_by_models(candidate: dict[str, Any]) -> bool:
    try:
        ADAPTER.validate_python(candidate)
    except ValidationError:
        return False
    return True


@pytest.mark.parametrize("event_type", sorted(VALID_PAYLOADS))
def test_valid_event_is_accepted_by_schema_and_models(
    validator: Draft202012Validator, event_type: str
) -> None:
    candidate = event(event_type)

    assert accepted_by_schema(validator, candidate), list(validator.iter_errors(candidate))
    assert accepted_by_models(candidate)


@pytest.mark.parametrize("event_type", sorted(VALID_PAYLOADS))
def test_models_round_trip_to_schema_valid_json(
    validator: Draft202012Validator, event_type: str
) -> None:
    parsed = ADAPTER.validate_python(event(event_type))

    dumped = json.loads(ADAPTER.dump_json(parsed))

    assert accepted_by_schema(validator, dumped), list(validator.iter_errors(dumped))
    assert dumped["type"] == event_type


@pytest.mark.parametrize("event_type", sorted(BLIND_OVERRIDES))
def test_blind_view_event_is_still_valid(validator: Draft202012Validator, event_type: str) -> None:
    candidate = {**event(event_type, **BLIND_OVERRIDES[event_type]), "redacted": True}

    assert accepted_by_schema(validator, candidate), list(validator.iter_errors(candidate))
    assert accepted_by_models(candidate)


INVALID_EVENTS: dict[str, dict[str, Any]] = {
    "unknown type": {**ENVELOPE, "type": "llm_delta", "payload": {}},
    "missing seq": {k: v for k, v in event("step_started").items() if k != "seq"},
    "negative seq": {**event("step_started"), "seq": -1},
    "bad side": {**event("step_started"), "side": "middle"},
    "extra envelope field": {**event("step_started"), "cost": 1},
    "extra payload field": event("step_started", note="x"),
    "payload of another type": {**event("step_started"), "payload": VALID_PAYLOADS["error"]},
    "unknown stop reason": event("run_finished", stop_reason="bored"),
    "unknown scorer": event("score_computed", scorer_type="vibes"),
    "score above one": event("score_computed", score=1.5),
    "unknown enabled tool": event(
        "run_started", config={**CONFIG, "enabled_tools": ["web_search"]}
    ),
    "step zero": event("step_started", step=0),
    "unknown backend": event("run_started", config={**CONFIG, "backend": "langchain"}),
    "missing reference cost": {
        **ENVELOPE,
        "type": "step_finished",
        "payload": {"step": 1, "total_tokens": 1, "cost_usd": 0.0},
    },
}


@pytest.mark.parametrize("name", sorted(INVALID_EVENTS))
def test_invalid_event_is_rejected_by_schema_and_models(
    validator: Draft202012Validator, name: str
) -> None:
    candidate = INVALID_EVENTS[name]

    assert not accepted_by_schema(validator, candidate)
    assert not accepted_by_models(candidate)


def test_every_event_type_in_the_schema_is_covered(validator: Draft202012Validator) -> None:
    schema: dict[str, Any] = validator.schema  # type: ignore[assignment]
    event_defs = [ref["$ref"].rsplit("/", 1)[-1] for ref in schema["oneOf"]]
    schema_types = {schema["$defs"][name]["properties"]["type"]["const"] for name in event_defs}

    assert schema_types == set(VALID_PAYLOADS)
