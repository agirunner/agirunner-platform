#!/usr/bin/env python3
from __future__ import annotations

import json
from typing import Any

TRACE_INLINE_BODY_MAX_BYTES = 16_384
TRACE_LIST_PREVIEW_COUNT = 3


def _build_trace_response_event(
    label: str,
    method: str,
    path: str,
    status: int,
    body: Any,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "event": "http.response",
        "label": label,
        "method": method,
        "path": path,
        "status": status,
    }
    encoded_body = json.dumps(body, sort_keys=True)
    body_bytes = len(encoded_body.encode("utf-8"))
    summary = _summarize_trace_body(label, path, body)
    if summary is not None:
        event["body_summary"] = summary
        event["body_bytes"] = body_bytes
        event["body_omitted"] = True
        return event
    if body_bytes <= TRACE_INLINE_BODY_MAX_BYTES:
        event["body"] = body
        return event
    event["body_summary"] = _summarize_large_body(body)
    event["body_bytes"] = body_bytes
    event["body_omitted"] = True
    return event


def _summarize_trace_body(label: str, path: str, body: Any) -> dict[str, Any] | None:
    if _is_logs_response(label, path):
        return _summarize_logs_response(body)
    if _is_workflow_snapshot_response(label, path):
        return _summarize_workflow_response(body)
    if label.startswith("work_items.") or "/work-items" in path:
        return _summarize_work_items_response(body)
    if label.startswith("approvals.") or "/approvals" in path:
        return _summarize_approvals_response(body)
    if label.startswith("fleet.") or "/execution-environments" in path:
        return _summarize_fleet_response(body)
    if body is None:
        return None
    return _summarize_large_body(body)


def _is_logs_response(label: str, path: str) -> bool:
    return label == "logs.list" or path.startswith("/api/v1/logs")


def _is_workflow_snapshot_response(label: str, path: str) -> bool:
    return label == "workflows.get" or (
        path.startswith("/api/v1/workflows/") and "/board" not in path and "/work-items" not in path
    )


def _summarize_logs_response(body: Any) -> dict[str, Any]:
    data = body.get("data", []) if isinstance(body, dict) else []
    rows = data if isinstance(data, list) else []
    pagination = body.get("pagination", {}) if isinstance(body, dict) else {}
    return {
        "kind": "logs_page",
        "row_count": len(rows),
        "categories": _count_values(rows, "category"),
        "operations": _count_values(rows, "operation"),
        "first_id": _safe_row_value(rows, 0, "id"),
        "last_id": _safe_row_value(rows, -1, "id"),
        "first_created_at": _safe_row_value(rows, 0, "created_at"),
        "last_created_at": _safe_row_value(rows, -1, "created_at"),
        "has_more": bool(pagination.get("has_more")) if isinstance(pagination, dict) else False,
        "next_cursor_present": bool(pagination.get("next_cursor")) if isinstance(pagination, dict) else False,
    }


def _summarize_workflow_response(body: Any) -> dict[str, Any]:
    data = body.get("data", {}) if isinstance(body, dict) else {}
    tasks = data.get("tasks", []) if isinstance(data, dict) else []
    work_items = data.get("work_items", []) if isinstance(data, dict) else []
    activations = data.get("activations", []) if isinstance(data, dict) else []
    return {
        "kind": "workflow_snapshot",
        "id": data.get("id") if isinstance(data, dict) else None,
        "state": data.get("state") if isinstance(data, dict) else None,
        "current_stage": data.get("current_stage") if isinstance(data, dict) else None,
        "updated_at": data.get("updated_at") if isinstance(data, dict) else None,
        "completed_at": data.get("completed_at") if isinstance(data, dict) else None,
        "task_count": len(tasks) if isinstance(tasks, list) else 0,
        "task_states": _count_fallback_values(tasks, ("state", "status")),
        "work_item_count": len(work_items) if isinstance(work_items, list) else 0,
        "work_item_states": _count_fallback_values(work_items, ("column_id", "state", "status")),
        "activation_count": len(activations) if isinstance(activations, list) else 0,
        "activation_states": _count_fallback_values(activations, ("state",)),
    }


def _summarize_work_items_response(body: Any) -> dict[str, Any]:
    rows = body.get("data", []) if isinstance(body, dict) else []
    items = rows if isinstance(rows, list) else []
    return {
        "kind": "work_items",
        "count": len(items),
        "states": _count_fallback_values(items, ("column_id", "state", "status")),
        "preview_ids": _preview_ids(items),
    }


def _summarize_approvals_response(body: Any) -> dict[str, Any]:
    data = body.get("data", {}) if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        return {"kind": "approvals", "stage_gate_count": 0, "task_approval_count": 0}
    return {
        "kind": "approvals",
        "stage_gate_count": len(data.get("stage_gates", [])) if isinstance(data.get("stage_gates"), list) else 0,
        "task_approval_count": len(data.get("task_approvals", [])) if isinstance(data.get("task_approvals"), list) else 0,
    }


def _summarize_fleet_response(body: Any) -> dict[str, Any]:
    data = body.get("data", {}) if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        return {"kind": "fleet"}
    summary = {"kind": "fleet"}
    for key in ("running_runtimes", "executing_runtimes", "active_workflows", "global_max_runtimes"):
        if key in data:
            summary[key] = data.get(key)
    recent_events = data.get("recent_events", [])
    if isinstance(recent_events, list):
        summary["recent_event_count"] = len(recent_events)
        summary["recent_event_types"] = _count_values(recent_events, "event_type")
    return summary


def _summarize_large_body(body: Any) -> dict[str, Any]:
    if isinstance(body, dict):
        return {
            "kind": "dict",
            "key_count": len(body),
            "keys": sorted(body.keys())[:TRACE_LIST_PREVIEW_COUNT],
        }
    if isinstance(body, list):
        return {
            "kind": "list",
            "length": len(body),
            "preview_ids": _preview_ids(body),
        }
    preview = str(body)
    if len(preview) > TRACE_INLINE_BODY_MAX_BYTES:
        preview = preview[:TRACE_INLINE_BODY_MAX_BYTES] + "...<truncated>"
    return {
        "kind": type(body).__name__,
        "preview": preview,
    }


def _count_values(rows: list[Any], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get(key)
        if value in (None, ""):
            continue
        name = str(value)
        counts[name] = counts.get(name, 0) + 1
    return counts


def _count_fallback_values(rows: list[Any], keys: tuple[str, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = None
        for key in keys:
            candidate = row.get(key)
            if candidate not in (None, ""):
                value = candidate
                break
        name = str(value) if value is not None else "unknown"
        counts[name] = counts.get(name, 0) + 1
    return counts


def _preview_ids(rows: list[Any]) -> list[str]:
    preview: list[str] = []
    for row in rows[:TRACE_LIST_PREVIEW_COUNT]:
        if not isinstance(row, dict):
            continue
        value = row.get("id")
        if isinstance(value, str) and value.strip():
            preview.append(value)
    return preview


def _safe_row_value(rows: list[Any], index: int, key: str) -> Any:
    if not rows:
        return None
    row = rows[index]
    if not isinstance(row, dict):
        return None
    return row.get(key)
