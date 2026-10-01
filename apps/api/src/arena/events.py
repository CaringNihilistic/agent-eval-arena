"""Builds trace events, validates each against the schema, and hands it to a sink."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from pydantic import TypeAdapter

from arena.schema_gen import TraceEvent
from arena.scrub import scrub, secret_values

Event = dict[str, Any]
Sink = Callable[[Event], None]

_ADAPTER: TypeAdapter[TraceEvent] = TypeAdapter(TraceEvent)


class Emitter:
    """One per run. `seq` starts at 0 and increases by exactly one per event."""

    def __init__(self, run_id: str, sink: Sink) -> None:
        self.run_id = run_id
        self._sink = sink
        self._seq = 0
        # Read once per run: the credentials that must never appear in an event.
        self._secrets = secret_values()

    def emit(self, event_type: str, payload: dict[str, Any]) -> Event:
        event: Event = {
            "run_id": self.run_id,
            "side": None,
            "seq": self._seq,
            "type": event_type,
            "timestamp": datetime.now(UTC).isoformat(),
            "redacted": False,
            "payload": scrub(payload, self._secrets),
        }
        # An event that does not match the schema is a bug; fail before it is stored.
        _ADAPTER.validate_python(event)
        self._seq += 1
        self._sink(event)
        return event
