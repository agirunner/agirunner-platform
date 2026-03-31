#!/usr/bin/env python3
from __future__ import annotations

from typing import Any
from urllib.parse import quote

from workflow_efficiency_summary import (
    _read_float,
    build_approval_metrics,
    build_specialist_teardown_summary,
    build_task_efficiency_summary,
)


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
        "orchestrator_max_llm_turns_per_attempt": max(
            (
                summary["llm_turns_per_attempt"]
                for summary in task_summaries.values()
                if summary["is_orchestrator_task"]
            ),
            default=0,
        ),
        "non_orchestrator_max_llm_turns_per_attempt": max(
            (
                summary["llm_turns_per_attempt"]
                for summary in task_summaries.values()
                if not summary["is_orchestrator_task"]
            ),
            default=0,
        ),
        "orchestrator_max_tool_steps": max(orchestrator_tool_steps, default=0),
        "non_orchestrator_max_tool_steps": max(specialist_tool_steps, default=0),
        "orchestrator_max_tool_steps_per_attempt": max(
            (
                summary["tool_steps_per_attempt"]
                for summary in task_summaries.values()
                if summary["is_orchestrator_task"]
            ),
            default=0,
        ),
        "non_orchestrator_max_tool_steps_per_attempt": max(
            (
                summary["tool_steps_per_attempt"]
                for summary in task_summaries.values()
                if not summary["is_orchestrator_task"]
            ),
            default=0,
        ),
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
        ("non_orchestrator_max_llm_turns_per_attempt_lte", "non_orchestrator_max_llm_turns_per_attempt"),
        ("orchestrator_max_llm_turns_lte", "orchestrator_max_llm_turns"),
        ("non_orchestrator_max_tool_steps_lte", "non_orchestrator_max_tool_steps"),
        ("non_orchestrator_max_tool_steps_per_attempt_lte", "non_orchestrator_max_tool_steps_per_attempt"),
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
            failures.append(f"expected efficiency metric {metric_key} <= {expected_max}, got {actual}")

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
            failures.append(f"expected efficiency metric {metric_key} <= {expected_max}, got {actual}")

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
            failures.append(f"expected specialist teardown lag <= {expected_max}, got {actual}")

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
            failures.append(f"expected orphan cleanup events == {expected_value}, got {actual}")

    return checks, failures


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


def _seconds_between(started_at: datetime | None, ended_at: datetime | None) -> float | None:
    if started_at is None or ended_at is None:
        return None
    return (ended_at - started_at).total_seconds()


def _read_string(row: dict[str, Any], key: str) -> str | None:
    value = row.get(key)
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None
