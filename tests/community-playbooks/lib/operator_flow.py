#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


TERMINAL_WORKFLOW_STATES = {"completed", "failed", "cancelled"}
TERMINAL_WORK_ITEM_STATES = {"completed", "done", "failed", "cancelled"}


def now_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def pending_workflow_approvals(approvals: dict[str, Any], workflow_id: str) -> list[dict[str, Any]]:
    pending: list[dict[str, Any]] = []
    for bucket in ("task_approvals", "stage_gates"):
        items = approvals.get(bucket, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("workflow_id") != workflow_id:
                continue
            if item.get("status") != "awaiting_approval":
                continue
            pending.append(item)
    return pending


def _matches_action(item: dict[str, Any], action: dict[str, Any]) -> bool:
    match = action.get("match")
    if not isinstance(match, dict) or not match:
        return True
    for key, expected in match.items():
        if item.get(key) != expected:
            return False
    return True


def _approval_feedback(action: str, run_id: str, feedback: str | None = None) -> str:
    if isinstance(feedback, str) and feedback.strip():
        return feedback.strip()
    action_copy = {
        "approve": "Approved",
        "reject": "Rejected",
        "request_changes": "Changes requested",
        "block": "Blocked",
    }.get(action)
    if action_copy is None:
        raise RuntimeError(f"unsupported approval action {action!r}")
    return f"{action_copy} by the community playbooks operator flow for run {run_id}."


def submit_pending_operator_approvals(
    api: Any,
    approvals: dict[str, Any],
    *,
    workflow_id: str,
    run_spec: dict[str, Any],
    consumed_action_indices: set[int],
    processed_gate_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    approval_actions = [
        dict(action)
        for action in list(run_spec.get("operator_actions") or [])
        if isinstance(action, dict) and str(action.get("kind") or "").strip() == "approval"
    ]
    seen_gate_ids = set() if processed_gate_ids is None else processed_gate_ids
    submitted: list[dict[str, Any]] = []
    for item in pending_workflow_approvals(approvals, workflow_id):
        gate_id = str(item.get("gate_id") or item.get("id") or "").strip()
        if gate_id == "":
            raise RuntimeError("approval gate id is required")
        if gate_id in seen_gate_ids:
            continue
        selected_action: dict[str, Any] | None = None
        selected_index: int | None = None
        for index, action in enumerate(approval_actions):
            if index in consumed_action_indices:
                continue
            if not isinstance(action.get("match"), dict) or not action.get("match"):
                continue
            if _matches_action(item, action):
                selected_action = action
                selected_index = index
                break
        if selected_action is None:
            selected_action = next(
                (
                    action
                    for action in approval_actions
                    if not isinstance(action.get("match"), dict) or not action.get("match")
                ),
                None,
            )
        if selected_action is None:
            raise RuntimeError(f"unhandled approval for workflow {workflow_id}: {gate_id}")
        decision = str(selected_action.get("decision") or "").strip()
        if decision not in {"approve", "reject", "request_changes", "block"}:
            raise RuntimeError(f"unsupported approval decision {decision!r}")
        api.submit_approval(
            gate_id,
            request_id=f"community-playbooks-{run_spec['id']}-{decision}-{gate_id}",
            action=decision,
            feedback=_approval_feedback(decision, str(run_spec["id"]), selected_action.get("feedback")),
        )
        if selected_index is not None:
            consumed_action_indices.add(selected_index)
        seen_gate_ids.add(gate_id)
        submitted.append(
            {
                "gate_id": gate_id,
                "action": decision,
                "stage_name": item.get("stage_name"),
                "task_id": item.get("task_id"),
                "submitted_at": now_timestamp(),
            }
        )
    return submitted


def select_work_item_for_steering(
    work_items: list[dict[str, Any]],
    *,
    preferred_title: str | None = None,
) -> dict[str, Any] | None:
    preferred = preferred_title.strip() if isinstance(preferred_title, str) else ""
    normalized_items = [item for item in work_items if isinstance(item, dict)]
    if preferred:
        for item in normalized_items:
            if str(item.get("title") or "").strip() == preferred:
                return item
    for item in normalized_items:
        state = str(item.get("state") or "").strip().lower()
        if state not in TERMINAL_WORK_ITEM_STATES:
            return item
    return normalized_items[0] if normalized_items else None


def _steering_condition_met(
    action: dict[str, Any],
    *,
    briefs: list[dict[str, Any]],
    work_items: list[dict[str, Any]],
) -> bool:
    when = str(action.get("when") or "immediate").strip()
    if when == "immediate":
        return True
    if when == "after_first_brief":
        return bool(briefs)
    if when == "after_first_work_item":
        return bool(work_items)
    raise RuntimeError(f"unsupported steering trigger {when!r}")


def submit_ready_steering_requests(
    api: Any,
    briefs: list[dict[str, Any]],
    work_items: list[dict[str, Any]],
    *,
    workflow_id: str,
    run_spec: dict[str, Any],
    consumed_indices: set[int],
) -> list[dict[str, Any]]:
    steering_script = list(run_spec.get("steering_script") or [])
    submitted: list[dict[str, Any]] = []
    for index, action in enumerate(steering_script):
        if index in consumed_indices or not isinstance(action, dict):
            continue
        if not _steering_condition_met(action, briefs=briefs, work_items=work_items):
            continue
        message = str(action.get("message") or "").strip()
        if message == "":
            raise RuntimeError("steering script message is required")
        target = select_work_item_for_steering(
            work_items,
            preferred_title=action.get("work_item_title"),
        )
        if target is None:
            continue
        work_item_id = str(target.get("id") or "").strip() or None
        api.submit_steering_request(
            workflow_id,
            request_id=f"community-playbooks-{run_spec['id']}-steering-{index + 1}",
            request_text=message,
            work_item_id=work_item_id,
            linked_input_packet_ids=list(action.get("linked_input_packet_ids") or []),
        )
        consumed_indices.add(index)
        submitted.append(
            {
                "work_item_id": work_item_id,
                "message": message,
                "submitted_at": now_timestamp(),
            }
        )
    return submitted
