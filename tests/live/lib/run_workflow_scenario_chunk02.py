#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk01 import *

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


def auto_approve_workflow_approvals(
    client: ApiClient,
    approvals: dict[str, Any],
    *,
    workflow_id: str,
    scenario_name: str,
    approved_gate_ids: set[str],
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for item in pending_workflow_approvals(approvals, workflow_id):
        gate_id = item.get("gate_id") or item.get("id")
        if not isinstance(gate_id, str) or gate_id.strip() == "":
            continue
        if gate_id in approved_gate_ids:
            continue
        client.request(
            "POST",
            f"/api/v1/approvals/{gate_id}",
            payload={
                "request_id": f"live-test-{scenario_name}-approve-{gate_id}",
                "action": "approve",
                "feedback": f"Approved by the live test operator flow for scenario {scenario_name}.",
            },
            expected=(200,),
            label=f"approvals.approve:{gate_id}",
        )
        approved_gate_ids.add(gate_id)
        actions.append(
            {
                "gate_id": gate_id,
                "action": "approve",
                "task_id": item.get("task_id"),
                "stage_name": item.get("stage_name"),
                "submitted_at": now_timestamp(),
            }
        )
    return actions


def approval_feedback(action: str, scenario_name: str, feedback: str | None = None) -> str:
    if feedback and feedback.strip():
        return feedback.strip()
    if action == "approve":
        return f"Approved by the live test operator flow for scenario {scenario_name}."
    if action == "block":
        return f"Blocked by the live test operator flow for scenario {scenario_name}."
    if action == "reject":
        return f"Rejected by the live test operator flow for scenario {scenario_name}."
    if action == "request_changes":
        return f"Changes requested by the live test operator flow for scenario {scenario_name}."
    raise RuntimeError(f"unsupported approval action: {action}")


def now_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def truncate(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    if max_chars <= 3:
        return value[:max_chars]
    return value[: max_chars - 3] + "..."


def matches_approval_decision(item: dict[str, Any], decision: dict[str, Any]) -> bool:
    match = decision.get("match", {})
    if not isinstance(match, dict) or not match:
        return False
    for key, expected in match.items():
        if item.get(key) != expected:
            return False
    return True


def apply_scripted_workflow_approvals(
    client: ApiClient,
    approvals: dict[str, Any],
    *,
    workflow_id: str,
    scenario_name: str,
    consumed_decisions: set[int],
    approval_decisions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for item in pending_workflow_approvals(approvals, workflow_id):
        decision_index = next(
            (
                index
                for index, decision in enumerate(approval_decisions)
                if index not in consumed_decisions and matches_approval_decision(item, decision)
            ),
            None,
        )
        if decision_index is None:
            raise RuntimeError(
                f"workflow {workflow_id} has no scripted approval decision for "
                f"stage={item.get('stage_name')!r} gate={item.get('gate_id') or item.get('id')!r}"
            )

        decision = approval_decisions[decision_index]
        gate_id = item.get("gate_id") or item.get("id")
        if not isinstance(gate_id, str) or gate_id.strip() == "":
            raise RuntimeError("approval gate id is required")
        action = str(decision.get("action") or "").strip()
        if action not in {"approve", "block", "reject", "request_changes"}:
            raise RuntimeError(f"unsupported approval action: {action}")

        client.request(
            "POST",
            f"/api/v1/approvals/{gate_id}",
            payload={
                "request_id": f"live-test-{scenario_name}-{action}-{gate_id}",
                "action": action,
                "feedback": approval_feedback(action, scenario_name, decision.get("feedback")),
            },
            expected=(200,),
            label=f"approvals.{action}:{gate_id}",
        )
        consumed_decisions.add(decision_index)
        actions.append(
            {
                "gate_id": gate_id,
                "action": action,
                "task_id": item.get("task_id"),
                "stage_name": item.get("stage_name"),
                "submitted_at": now_timestamp(),
            }
        )
    return actions


def process_workflow_approvals(
    client: ApiClient,
    approvals: dict[str, Any],
    *,
    workflow_id: str,
    scenario_name: str,
    approved_gate_ids: set[str],
    approval_mode: str,
    consumed_decisions: set[int] | None = None,
    approval_decisions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    pending = pending_workflow_approvals(approvals, workflow_id)
    if approval_mode == "none":
        if pending:
            gate_ids = ", ".join(
                str(item.get("gate_id") or item.get("id") or "<unknown>")
                for item in pending
            )
            raise RuntimeError(
                f"workflow {workflow_id} requested approval(s) in scenario {scenario_name} "
                f"with approval_mode=none: {gate_ids}"
            )
        return []
    if approval_mode == "approve_all":
        return auto_approve_workflow_approvals(
            client,
            approvals,
            workflow_id=workflow_id,
            scenario_name=scenario_name,
            approved_gate_ids=approved_gate_ids,
        )
    if approval_mode == "scripted":
        return apply_scripted_workflow_approvals(
            client,
            approvals,
            workflow_id=workflow_id,
            scenario_name=scenario_name,
            consumed_decisions=set() if consumed_decisions is None else consumed_decisions,
            approval_decisions=[] if approval_decisions is None else approval_decisions,
        )
    raise RuntimeError(f"unsupported LIVE_TEST_APPROVAL_MODE: {approval_mode}")


def _nested_data(snapshot: Any) -> Any:
    current = snapshot
    while isinstance(current, dict) and "data" in current and len(current) <= 2:
        current = current["data"]
    return current


def _board_columns(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    if not isinstance(data, dict):
        return []
    columns = data.get("columns", [])
    return columns if isinstance(columns, list) else []


def _board_work_items(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    if not isinstance(data, dict):
        return []
    work_items = data.get("work_items", [])
    return work_items if isinstance(work_items, list) else []


def _count_blocked_board_items(snapshot: Any) -> int:
    blocked_column_ids = {
        str(column.get("id"))
        for column in _board_columns(snapshot)
        if isinstance(column, dict) and column.get("is_blocked") is True and column.get("id")
    }
    blocked_items = 0
    for work_item in _board_work_items(snapshot):
        if not isinstance(work_item, dict):
            continue
        if work_item.get("column_id") in blocked_column_ids:
            blocked_items += 1
            continue
        if work_item.get("assessment_status") == "blocked":
            blocked_items += 1
            continue
        if work_item.get("gate_status") in {"changes_requested", "rejected"}:
            blocked_items += 1
    return blocked_items


def _terminal_board_column_ids(snapshot: Any) -> set[str]:
    return {
        str(column.get("id"))
        for column in _board_columns(snapshot)
        if isinstance(column, dict) and column.get("is_terminal") is True and column.get("id")
    }


def _work_item_is_terminal(item: dict[str, Any], board_snapshot: Any) -> bool:
    terminal_column_ids = _terminal_board_column_ids(board_snapshot)
    if not terminal_column_ids:
        return False
    return str(item.get("column_id") or "") in terminal_column_ids


def _work_items(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _artifacts(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        items = data.get("items", [])
        if isinstance(items, list):
            return items
    return []


def _db_state_tasks(snapshot: Any) -> list[dict[str, Any]]:
    if not isinstance(snapshot, dict):
        return []
    tasks = snapshot.get("tasks", [])
    return tasks if isinstance(tasks, list) else []


def summarize_execution_environment_usage(
    expectations: dict[str, Any] | None,
    db_state: dict[str, Any] | None,
) -> dict[str, Any]:
    expectation_payload = expectations if isinstance(expectations, dict) else {}
    db_payload = db_state if isinstance(db_state, dict) else {}
    role_expectations = expectation_payload.get("roles", [])
    if not isinstance(role_expectations, list) or not role_expectations:
        return {
            "applicable": False,
            "passed": True,
            "checked_task_count": 0,
            "mismatch_count": 0,
            "mismatches": [],
            "observed_environment_ids": [],
            "selected_default_environment_id": expectation_payload.get("selected_default_environment_id"),
            "tenant_default_environment_id": expectation_payload.get("tenant_default_environment_id"),
        }

    selected_default_environment_id = str(expectation_payload.get("selected_default_environment_id") or "").strip()
    tenant_default_environment_id = str(expectation_payload.get("tenant_default_environment_id") or "").strip()
    role_expectation_by_name = {
        str(role.get("name") or "").strip(): role
        for role in role_expectations
        if isinstance(role, dict) and isinstance(role.get("name"), str)
    }
    mismatches: list[dict[str, Any]] = []
    observed_environment_ids: set[str] = set()
    checked_task_count = 0
    if selected_default_environment_id and tenant_default_environment_id:
        if selected_default_environment_id != tenant_default_environment_id:
            mismatches.append(
                {
                    "task_id": None,
                    "role": None,
                    "expected_environment_id": selected_default_environment_id,
                    "actual_environment_id": tenant_default_environment_id,
                    "reason": "selected default execution environment does not match the tenant default execution environment",
                }
            )

    for task in _db_state_tasks(db_payload):
        if not isinstance(task, dict):
            continue
        if bool(task.get("is_orchestrator_task")):
            continue
        if str(task.get("execution_backend") or "") != "runtime_plus_task":
            continue
        role_name = str(task.get("role") or "").strip()
        role_expectation = role_expectation_by_name.get(role_name)
        if role_expectation is None:
            continue
        checked_task_count += 1
        actual_environment_id = str(task.get("execution_environment_id") or "").strip()
        if actual_environment_id:
            observed_environment_ids.add(actual_environment_id)
        snapshot = task.get("execution_environment_snapshot")
        snapshot_environment_id = ""
        if isinstance(snapshot, dict):
            snapshot_environment_id = str(snapshot.get("id") or "").strip()

        use_default = bool(role_expectation.get("use_default_execution_environment"))
        expected_environment_id = (
            tenant_default_environment_id
            if use_default
            else str(role_expectation.get("execution_environment_id") or "").strip()
        )
        expectation_reason = (
            "tenant default execution environment"
            if use_default
            else "explicit role execution environment"
        )

        if expected_environment_id and actual_environment_id != expected_environment_id:
            mismatches.append(
                {
                    "task_id": task.get("id"),
                    "role": role_name,
                    "expected_environment_id": expected_environment_id,
                    "actual_environment_id": actual_environment_id,
                    "reason": f"task did not use the expected {expectation_reason}",
                }
            )
        if snapshot_environment_id and actual_environment_id and snapshot_environment_id != actual_environment_id:
            mismatches.append(
                {
                    "task_id": task.get("id"),
                    "role": role_name,
                    "expected_environment_id": actual_environment_id,
                    "actual_environment_id": snapshot_environment_id,
                    "reason": "execution environment snapshot id does not match the task execution environment id",
                }
            )

    return {
        "applicable": checked_task_count > 0 or len(mismatches) > 0,
        "passed": len(mismatches) == 0,
        "checked_task_count": checked_task_count,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches,
        "observed_environment_ids": sorted(observed_environment_ids),
        "selected_default_environment_id": selected_default_environment_id or None,
        "tenant_default_environment_id": tenant_default_environment_id or None,
    }

__all__ = [name for name in globals() if not name.startswith("__")]
