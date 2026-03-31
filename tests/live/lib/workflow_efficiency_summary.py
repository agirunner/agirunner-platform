#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def build_task_efficiency_summary(workflow: dict[str, Any], log_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    task_summaries: dict[str, dict[str, Any]] = {}
    for task in workflow.get("tasks", []):
        if not isinstance(task, dict):
            continue
        task_id = task.get("id")
        if not isinstance(task_id, str) or task_id.strip() == "":
            continue
        task_summaries[task_id] = {
            "task_id": task_id,
            "role": task.get("role"),
            "is_orchestrator_task": bool(task.get("is_orchestrator_task")),
            "state": task.get("state"),
            "attempt_count": max(1, _read_int(task.get("rework_count")) + 1),
            "llm_turns": 0,
            "tool_steps": 0,
            "burst_ids": set(),
            "burst_count": 0,
            "max_repeated_read_count": 0,
            "max_duplicate_status_check_count": 0,
            "max_checkpoint_count": 0,
            "max_duplicate_metadata_save_count": 0,
            "llm_turns_per_attempt": 0,
            "tool_steps_per_attempt": 0,
        }
    for row in log_rows:
        if not isinstance(row, dict):
            continue
        task_id = _read_string(row, "task_id")
        if task_id is None or task_id not in task_summaries:
            continue
        summary = task_summaries[task_id]
        category = _read_string(row, "category") or ""
        operation = _read_string(row, "operation") or ""
        if category == "llm":
            summary["llm_turns"] += 1
        if category == "tool" or operation.startswith("tool.") or operation.startswith("shell."):
            summary["tool_steps"] += 1
        burst_id = _read_string(row, "burst_id")
        if burst_id is not None:
            summary["burst_ids"].add(burst_id)
        summary["burst_count"] = len(summary["burst_ids"])
        summary["max_repeated_read_count"] = max(
            summary["max_repeated_read_count"],
            _read_int(row.get("repeated_read_count")),
        )
        summary["max_duplicate_status_check_count"] = max(
            summary["max_duplicate_status_check_count"],
            _read_int(row.get("duplicate_status_check_count")),
        )
        summary["max_checkpoint_count"] = max(summary["max_checkpoint_count"], _read_int(row.get("checkpoint_count")))
        summary["max_duplicate_metadata_save_count"] = max(
            summary["max_duplicate_metadata_save_count"],
            _read_int(row.get("duplicate_metadata_save_count")),
        )
    for summary in task_summaries.values():
        attempts = max(1, int(summary["attempt_count"]))
        summary["llm_turns_per_attempt"] = summary["llm_turns"] / attempts
        summary["tool_steps_per_attempt"] = summary["tool_steps"] / attempts
        summary["burst_ids"] = sorted(summary["burst_ids"])
    return task_summaries


def build_approval_metrics(events: Any, approval_actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    event_rows = _event_rows(events)
    metrics: list[dict[str, Any]] = []
    for approval in approval_actions:
        if not isinstance(approval, dict):
            continue
        gate_id = _read_string(approval, "stage_gate_id")
        if gate_id is None:
            continue
        decision_event = _find_gate_event(event_rows, gate_id=gate_id, event_type="stage_gate_decision")
        continuation_started = _find_activation_event(
            event_rows,
            gate_id=gate_id,
            event_type="workflow_continuation_started",
            activation_id=_read_string(approval, "workflow_continuation_activation_id"),
        )
        continuation_completed = _find_activation_completion(
            event_rows,
            gate_id=gate_id,
            event_type="workflow_continuation_completed",
            activation_id=_read_string(approval, "workflow_continuation_activation_id"),
        )
        metrics.append(
            {
                "stage_gate_id": gate_id,
                "task_id": _read_string(approval, "task_id"),
                "decision_at": _parse_timestamp(_read_string(approval, "decided_at")),
                "decision_to_continuation_started_seconds": _seconds_between(
                    _parse_timestamp(_read_string(approval, "decided_at")),
                    _parse_timestamp(_read_string(continuation_started, "created_at")),
                ),
                "decision_to_continuation_completed_seconds": _seconds_between(
                    _parse_timestamp(_read_string(approval, "decided_at")),
                    _parse_timestamp(_read_string(continuation_completed, "created_at")),
                ),
                "decision_event_id": _read_string(decision_event, "id"),
                "continuation_started_event_id": _read_string(continuation_started, "id"),
                "continuation_completed_event_id": _read_string(continuation_completed, "id"),
            }
        )
    return metrics


def build_specialist_teardown_summary(
    task_summaries: dict[str, dict[str, Any]],
    log_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    orphan_cleanup_events = 0
    max_lag_seconds: float | None = None
    for row in log_rows:
        if not isinstance(row, dict):
            continue
        operation = _read_string(row, "operation") or ""
        if operation not in {"workflow.cleanup", "workflow.specialist_teardown", "tool.cleanup"}:
            continue
        orphan_cleanup_events += 1
        started_at = _parse_timestamp(_read_string(row, "started_at"))
        completed_at = _parse_timestamp(_read_string(row, "completed_at"))
        lag_seconds = _seconds_between(started_at, completed_at)
        if lag_seconds is None:
            continue
        if max_lag_seconds is None or lag_seconds > max_lag_seconds:
            max_lag_seconds = lag_seconds
    return {
        "orphan_cleanup_events": orphan_cleanup_events,
        "max_lag_seconds": max_lag_seconds,
        "task_count": len(task_summaries),
    }


def _workflow_duration_seconds(workflow: dict[str, Any], events: Any) -> float | None:
    created_at = _parse_timestamp(_read_string(workflow, "created_at"))
    completed_at = _parse_timestamp(_read_string(workflow, "completed_at"))
    if created_at is None or completed_at is None:
        event_rows = _event_rows(events)
        if created_at is None:
            activation = _find_activation_event(event_rows, gate_id=None, event_type="workflow_activation_started", activation_id=None)
            created_at = _parse_timestamp(_read_string(activation, "created_at"))
        if completed_at is None:
            completion = _find_activation_completion(event_rows, gate_id=None, event_type="workflow_completed", activation_id=None)
            completed_at = _parse_timestamp(_read_string(completion, "created_at"))
    return _seconds_between(created_at, completed_at)


def _log_rows(logs: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(logs, dict):
        data = logs.get("data")
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
    return [row for row in logs if isinstance(row, dict)]


def _event_rows(events: Any) -> list[dict[str, Any]]:
    if isinstance(events, dict):
        data = events.get("data")
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
    return [row for row in events if isinstance(row, dict)] if isinstance(events, list) else []


def _find_gate_event(event_rows: list[dict[str, Any]], *, gate_id: str, event_type: str) -> dict[str, Any] | None:
    for row in event_rows:
        if _read_string(row, "event_type") != event_type:
            continue
        if _read_string(row, "stage_gate_id") == gate_id:
            return row
    return None


def _find_activation_event(
    event_rows: list[dict[str, Any]],
    *,
    gate_id: str | None,
    event_type: str,
    activation_id: str | None,
) -> dict[str, Any] | None:
    for row in event_rows:
        if _read_string(row, "event_type") != event_type:
            continue
        if gate_id is not None and _read_string(row, "stage_gate_id") != gate_id:
            continue
        if activation_id is not None and _read_string(row, "activation_id") != activation_id:
            continue
        return row
    return None


def _find_activation_completion(
    event_rows: list[dict[str, Any]],
    *,
    gate_id: str | None,
    event_type: str,
    activation_id: str | None,
) -> dict[str, Any] | None:
    return _find_activation_event(
        event_rows,
        gate_id=gate_id,
        event_type=event_type,
        activation_id=activation_id,
    )


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or value.strip() == "":
        return None
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _latest_time(current: datetime | None, candidate: datetime | None) -> datetime | None:
    if candidate is None:
        return current
    if current is None or candidate > current:
        return candidate
    return current


def _seconds_between(started_at: datetime | None, ended_at: datetime | None) -> float | None:
    if started_at is None or ended_at is None:
        return None
    return (ended_at - started_at).total_seconds()


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def _read_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _read_string(row: dict[str, Any], key: str) -> str | None:
    value = row.get(key)
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None
