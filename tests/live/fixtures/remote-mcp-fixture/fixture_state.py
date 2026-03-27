#!/usr/bin/env python3
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from threading import Lock
from typing import Any


_LOCK = Lock()
_EVENTS: list[dict[str, Any]] = []
_NEXT_EVENT_ID = 1


def record_invocation(kind: str, endpoint: str, **fields: Any) -> None:
    global _NEXT_EVENT_ID
    event = {
        "event_id": None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "endpoint": endpoint,
    }
    event.update(fields)
    with _LOCK:
        event["event_id"] = _NEXT_EVENT_ID
        _NEXT_EVENT_ID += 1
        _EVENTS.append(event)


def snapshot_invocations() -> dict[str, Any]:
    with _LOCK:
        events = [dict(event) for event in _EVENTS]
    counts = Counter(event.get("kind") for event in events)
    tool_calls = [event for event in events if event.get("kind") == "tool_call"]
    return {
        "event_count": len(events),
        "last_event_id": events[-1]["event_id"] if events else 0,
        "counts": dict(sorted(counts.items())),
        "tool_call_count": len(tool_calls),
        "tool_names": [event.get("tool_name") for event in tool_calls if isinstance(event.get("tool_name"), str)],
        "events": events,
    }
