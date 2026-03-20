#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote


TERMINAL_TASK_STATUSES = {"completed", "failed", "cancelled"}


def collect_execution_logs(client: Any, *, workflow_id: str, per_page: int = 250) -> dict[str, Any]:
    cursor: str | None = None
    collected: list[dict[str, Any]] = []

    while True:
        path = f"/api/v1/logs?workflow_id={workflow_id}&per_page={per_page}&detail=full&order=asc"
        if cursor:
            path = f"{path}&cursor={quote(cursor, safe='')}"

        page = client.request("GET", path, expected=(200,), label="logs.list")
        if not isinstance(page, dict):
            raise RuntimeError(f"unexpected execution logs payload: {page!r}")

        rows = page.get("data", [])
        if not isinstance(rows, list):
            raise RuntimeError(f"unexpected execution logs data payload: {rows!r}")
        collected.extend(row for row in rows if isinstance(row, dict))

        pagination = page.get("pagination", {})
        if not isinstance(pagination, dict):
            return {"data": collected, "pagination": {}}
        if not pagination.get("has_more"):
            return {"data": collected, "pagination": pagination}

        next_cursor = pagination.get("next_cursor")
        if not isinstance(next_cursor, str) or next_cursor.strip() == "":
            return {"data": collected, "pagination": pagination}
        cursor = next_cursor


def summarize_efficiency(
    *,
    workflow: dict[str, Any],
    logs: dict[str, Any] | list[dict[str, Any]],
    events: Any,
    approval_actions: list[dict[str, Any]],
) -> dict[str, Any]:
    log_rows = _log_rows(logs)
    task_summaries = build_task_efficiency_summary(workflow, log_rows)
    approval_metrics = build_approval_metrics(events, approval_actions)
    specialist_teardown = build_specialist_teardown_summary(task_summaries, log_rows)

    orchestrator_llm_turns = [
        summary["llm_turns"]
        for summary in task_summaries.values()
        if summary["is_orchestrator_task"]
    ]
    specialist_llm_turns = [
        summary["llm_turns"]
        for summary in task_summaries.values()
        if not summary["is_orchestrator_task"]
    ]
    orchestrator_tool_steps = [
        summary["tool_steps"]
        for summary in task_summaries.values()
        if summary["is_orchestrator_task"]
    ]
    specialist_tool_steps = [
        summary["tool_steps"]
        for summary in task_summaries.values()
        if not summary["is_orchestrator_task"]
    ]

    return {
        "workflow_duration_seconds": _workflow_duration_seconds(workflow, events),
        "log_count": len(log_rows),
        "total_llm_turns": sum(summary["llm_turns"] for summary in task_summaries.values()),
        "total_tool_steps": sum(summary["tool_steps"] for summary in task_summaries.values()),
        "total_bursts": sum(summary["burst_count"] for summary in task_summaries.values()),
        "orchestrator_max_llm_turns": max(orchestrator_llm_turns, default=0),
        "non_orchestrator_max_llm_turns": max(specialist_llm_turns, default=0),
        "orchestrator_max_tool_steps": max(orchestrator_tool_steps, default=0),
        "non_orchestrator_max_tool_steps": max(specialist_tool_steps, default=0),
        "tasks": task_summaries,
        "approval_metrics": approval_metrics,
        "specialist_teardown": specialist_teardown,
    }


def evaluate_efficiency_expectations(
    expectations: dict[str, Any],
    efficiency: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    checks: list[dict[str, Any]] = []
    failures: list[str] = []
    if not expectations:
        return checks, failures

    metrics = {} if efficiency is None else efficiency
    scalar_fields = (
        ("workflow_duration_seconds_lte", "workflow_duration_seconds"),
        ("non_orchestrator_max_llm_turns_lte", "non_orchestrator_max_llm_turns"),
        ("orchestrator_max_llm_turns_lte", "orchestrator_max_llm_turns"),
        ("non_orchestrator_max_tool_steps_lte", "non_orchestrator_max_tool_steps"),
        ("orchestrator_max_tool_steps_lte", "orchestrator_max_tool_steps"),
    )
    for expectation_key, metric_key in scalar_fields:
        if expectation_key not in expectations:
            continue
        expected_max = float(expectations[expectation_key])
        actual = _read_float(metrics.get(metric_key))
        passed = actual is not None and actual <= expected_max
        checks.append(
            {
                "name": f"efficiency.{expectation_key}",
                "passed": passed,
                "expected_max": expected_max,
                "actual": actual,
            }
        )
        if not passed:
            failures.append(
                f"expected efficiency metric {metric_key} <= {expected_max}, got {actual}"
            )

    approval_metrics = metrics.get("approval_metrics")
    if not isinstance(approval_metrics, list):
        approval_metrics = []

    approval_scalar_fields = (
        (
            "approval_decision_to_continuation_started_seconds_lte",
            "decision_to_continuation_started_seconds",
        ),
        (
            "approval_decision_to_continuation_completed_seconds_lte",
            "decision_to_continuation_completed_seconds",
        ),
    )
    for expectation_key, metric_key in approval_scalar_fields:
        if expectation_key not in expectations:
            continue
        expected_max = float(expectations[expectation_key])
        values = [
            value
            for value in (_read_float(metric.get(metric_key)) for metric in approval_metrics if isinstance(metric, dict))
            if value is not None
        ]
        actual = max(values, default=None)
        passed = actual is not None and actual <= expected_max
        checks.append(
            {
                "name": f"efficiency.{expectation_key}",
                "passed": passed,
                "expected_max": expected_max,
                "actual": actual,
            }
        )
        if not passed:
            failures.append(
                f"expected efficiency metric {metric_key} <= {expected_max}, got {actual}"
            )

    specialist_teardown = metrics.get("specialist_teardown")
    if not isinstance(specialist_teardown, dict):
        specialist_teardown = {}

    if "specialist_teardown_lag_seconds_lte" in expectations:
        expected_max = float(expectations["specialist_teardown_lag_seconds_lte"])
        actual = _read_float(specialist_teardown.get("max_lag_seconds"))
        passed = actual is not None and actual <= expected_max
        checks.append(
            {
                "name": "efficiency.specialist_teardown_lag_seconds_lte",
                "passed": passed,
                "expected_max": expected_max,
                "actual": actual,
            }
        )
        if not passed:
            failures.append(
                f"expected specialist teardown lag <= {expected_max}, got {actual}"
            )

    if "orphan_cleanup_events_eq" in expectations:
        expected_value = int(expectations["orphan_cleanup_events_eq"])
        actual = int(specialist_teardown.get("orphan_cleanup_events", 0))
        passed = actual == expected_value
        checks.append(
            {
                "name": "efficiency.orphan_cleanup_events_eq",
                "passed": passed,
                "expected": expected_value,
                "actual": actual,
            }
        )
        if not passed:
            failures.append(
                f"expected orphan cleanup events == {expected_value}, got {actual}"
            )

    return checks, failures


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
            "llm_turns": 0,
            "tool_steps": 0,
            "burst_ids": set(),
            "burst_count": 0,
            "max_repeated_read_count": 0,
            "max_duplicate_status_check_count": 0,
            "max_checkpoint_count": 0,
            "max_verify_count": 0,
            "task_terminal_at": None,
            "container_removed_at": None,
            "teardown_completed_at": None,
            "teardown_lag_seconds": None,
        }

    for row in log_rows:
        task_id = row.get("task_id")
        if not isinstance(task_id, str) or task_id.strip() == "":
            continue
        summary = task_summaries.setdefault(
            task_id,
            {
                "task_id": task_id,
                "role": row.get("role"),
                "is_orchestrator_task": bool(row.get("is_orchestrator_task")),
                "state": None,
                "llm_turns": 0,
                "tool_steps": 0,
                "burst_ids": set(),
                "burst_count": 0,
                "max_repeated_read_count": 0,
                "max_duplicate_status_check_count": 0,
                "max_checkpoint_count": 0,
                "max_verify_count": 0,
                "task_terminal_at": None,
                "container_removed_at": None,
                "teardown_completed_at": None,
                "teardown_lag_seconds": None,
            },
        )
        payload = row.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        if row.get("operation") == "llm.chat_stream" and row.get("status") == "completed":
            summary["llm_turns"] += 1
        if row.get("operation") == "tool.execute" and row.get("status") in TERMINAL_TASK_STATUSES:
            summary["tool_steps"] += 1
        burst_id = payload.get("burst_id")
        if isinstance(burst_id, int) and burst_id > 0:
            summary["burst_ids"].add(burst_id)
        summary["max_repeated_read_count"] = max(
            summary["max_repeated_read_count"],
            _read_int(payload.get("repeated_read_count")),
        )
        summary["max_duplicate_status_check_count"] = max(
            summary["max_duplicate_status_check_count"],
            _read_int(payload.get("duplicate_status_check_count")),
        )
        summary["max_checkpoint_count"] = max(
            summary["max_checkpoint_count"],
            _read_int(payload.get("checkpoint_count")),
        )
        summary["max_verify_count"] = max(
            summary["max_verify_count"],
            _read_int(payload.get("verify_count")),
        )

        created_at = _parse_timestamp(row.get("created_at"))
        if row.get("operation") == "task.execute" and row.get("status") in TERMINAL_TASK_STATUSES:
            summary["task_terminal_at"] = _latest_time(summary["task_terminal_at"], created_at)
        if row.get("operation") == "container.remove" and row.get("status") == "completed":
            summary["container_removed_at"] = _latest_time(summary["container_removed_at"], created_at)
            summary["teardown_completed_at"] = _latest_time(summary["teardown_completed_at"], created_at)
        if row.get("operation") in {"task.teardown_completed", "runtime.teardown_completed"} and row.get("status") == "completed":
            summary["teardown_completed_at"] = _latest_time(summary["teardown_completed_at"], created_at)

    for summary in task_summaries.values():
        summary["burst_count"] = len(summary["burst_ids"])
        summary.pop("burst_ids", None)
        terminal_at = summary.get("task_terminal_at")
        removed_at = summary.get("container_removed_at")
        teardown_completed_at = summary.get("teardown_completed_at")
        effective_teardown_at = removed_at
        if not isinstance(effective_teardown_at, datetime):
            effective_teardown_at = teardown_completed_at
        if (
            not summary.get("is_orchestrator_task")
            and isinstance(terminal_at, datetime)
            and isinstance(effective_teardown_at, datetime)
            and effective_teardown_at >= terminal_at
        ):
            summary["teardown_lag_seconds"] = round((effective_teardown_at - terminal_at).total_seconds(), 3)
        if isinstance(terminal_at, datetime):
            summary["task_terminal_at"] = terminal_at.isoformat()
        if isinstance(removed_at, datetime):
            summary["container_removed_at"] = removed_at.isoformat()
        if isinstance(teardown_completed_at, datetime):
            summary["teardown_completed_at"] = teardown_completed_at.isoformat()

    return task_summaries


def build_approval_metrics(events: Any, approval_actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    event_list = sorted(
        _event_rows(events),
        key=lambda item: _parse_timestamp(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
    )
    metrics: list[dict[str, Any]] = []
    for action in approval_actions:
        if not isinstance(action, dict):
            continue
        gate_id = action.get("gate_id")
        decision = action.get("action")
        if not isinstance(gate_id, str) or gate_id.strip() == "":
            continue
        if not isinstance(decision, str) or decision.strip() == "":
            continue

        requested_event = _find_gate_event(event_list, gate_id=gate_id, event_type="stage.gate_requested")
        decision_event = _find_gate_event(event_list, gate_id=gate_id, event_type=f"stage.gate.{decision}")
        submitted_at = _parse_timestamp(action.get("submitted_at"))
        decision_at = _parse_timestamp(decision_event.get("created_at")) if decision_event else submitted_at
        requested_at = _parse_timestamp(requested_event.get("created_at")) if requested_event else None
        continuation_started = _find_activation_event(
            event_list,
            after=decision_at,
            event_type="workflow.activation_started",
            trigger_event_type=f"stage.gate.{decision}",
        )
        continuation_completed = None
        if continuation_started is not None:
            continuation_completed = _find_activation_completion(
                event_list,
                activation_id=_read_string(continuation_started.get("data"), "activation_id"),
                after=_parse_timestamp(continuation_started.get("created_at")),
            )

        metrics.append(
            {
                "gate_id": gate_id,
                "action": decision,
                "stage_name": action.get("stage_name"),
                "requested_at": _isoformat(requested_at),
                "decision_at": _isoformat(decision_at),
                "request_to_decision_seconds": _seconds_between(requested_at, decision_at),
                "continuation_started_at": _isoformat(_parse_timestamp(continuation_started.get("created_at")) if continuation_started else None),
                "continuation_completed_at": _isoformat(_parse_timestamp(continuation_completed.get("created_at")) if continuation_completed else None),
                "decision_to_continuation_started_seconds": _seconds_between(
                    decision_at,
                    _parse_timestamp(continuation_started.get("created_at")) if continuation_started else None,
                ),
                "decision_to_continuation_completed_seconds": _seconds_between(
                    decision_at,
                    _parse_timestamp(continuation_completed.get("created_at")) if continuation_completed else None,
                ),
            }
        )
    return metrics


def build_specialist_teardown_summary(
    task_summaries: dict[str, dict[str, Any]],
    log_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    teardown_lags = [
        float(summary["teardown_lag_seconds"])
        for summary in task_summaries.values()
        if not summary.get("is_orchestrator_task") and summary.get("teardown_lag_seconds") is not None
    ]
    missing_task_ids = [
        str(summary["task_id"])
        for summary in task_summaries.values()
        if not summary.get("is_orchestrator_task")
        and summary.get("state") in TERMINAL_TASK_STATUSES
        and summary.get("teardown_lag_seconds") is None
    ]
    orphan_cleanup_events = sum(
        1
        for row in log_rows
        if row.get("operation") in {"orphan.cleaned", "runtime_orphan_cleaned"}
    )
    return {
        "measured_count": len(teardown_lags),
        "missing_task_ids": missing_task_ids,
        "max_lag_seconds": max(teardown_lags, default=None),
        "orphan_cleanup_events": orphan_cleanup_events,
    }


def _workflow_duration_seconds(workflow: dict[str, Any], events: Any) -> float | None:
    started_at = _parse_timestamp(workflow.get("created_at"))
    completed_at = _parse_timestamp(workflow.get("completed_at"))
    event_rows = _event_rows(events)
    if started_at is None and event_rows:
        started_at = min(
            (_parse_timestamp(item.get("created_at")) for item in event_rows),
            default=None,
        )
    if completed_at is None and event_rows:
        completed_at = max(
            (_parse_timestamp(item.get("created_at")) for item in event_rows),
            default=None,
        )
    return _seconds_between(started_at, completed_at)


def _log_rows(logs: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(logs, list):
        return [row for row in logs if isinstance(row, dict)]
    if isinstance(logs, dict):
        rows = logs.get("data", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def _event_rows(events: Any) -> list[dict[str, Any]]:
    current = events
    while isinstance(current, dict) and "data" in current and len(current) <= 2:
        current = current["data"]
    if not isinstance(current, list):
        return []
    return [row for row in current if isinstance(row, dict)]


def _find_gate_event(event_rows: list[dict[str, Any]], *, gate_id: str, event_type: str) -> dict[str, Any] | None:
    for item in event_rows:
        if item.get("type") != event_type:
            continue
        data = item.get("data")
        if isinstance(data, dict) and data.get("gate_id") == gate_id:
            return item
    return None


def _find_activation_event(
    event_rows: list[dict[str, Any]],
    *,
    after: datetime | None,
    event_type: str,
    trigger_event_type: str,
) -> dict[str, Any] | None:
    for item in event_rows:
        if item.get("type") != event_type:
            continue
        created_at = _parse_timestamp(item.get("created_at"))
        if after is not None and (created_at is None or created_at < after):
            continue
        data = item.get("data")
        if isinstance(data, dict) and data.get("event_type") == trigger_event_type:
            return item
    return None


def _find_activation_completion(
    event_rows: list[dict[str, Any]],
    *,
    activation_id: str | None,
    after: datetime | None,
) -> dict[str, Any] | None:
    for item in event_rows:
        if item.get("type") != "workflow.activation_completed":
            continue
        created_at = _parse_timestamp(item.get("created_at"))
        if after is not None and (created_at is None or created_at < after):
            continue
        data = item.get("data")
        if not isinstance(data, dict):
            continue
        if activation_id and data.get("activation_id") != activation_id:
            continue
        return item
    return None


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if normalized == "":
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _latest_time(current: datetime | None, candidate: datetime | None) -> datetime | None:
    if current is None:
        return candidate
    if candidate is None:
        return current
    return candidate if candidate > current else current


def _seconds_between(started_at: datetime | None, ended_at: datetime | None) -> float | None:
    if started_at is None or ended_at is None:
        return None
    if ended_at < started_at:
        return None
    return round((ended_at - started_at).total_seconds(), 3)


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _read_int(value: Any) -> int:
    return int(value) if isinstance(value, int | float) else 0


def _read_float(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    return None


def _read_string(value: Any, key: str) -> str | None:
    if not isinstance(value, dict):
        return None
    field = value.get(key)
    return field if isinstance(field, str) and field.strip() != "" else None
