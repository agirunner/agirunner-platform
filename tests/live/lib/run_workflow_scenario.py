#!/usr/bin/env python3
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from live_test_api import ApiClient, TraceRecorder, read_json
from scenario_config import load_scenario
from workflow_efficiency import (
    collect_execution_logs,
    evaluate_efficiency_expectations,
    summarize_efficiency,
)

TERMINAL_STATES = {"completed", "failed", "cancelled"}
DEFAULT_FINAL_SETTLE_ATTEMPTS = 20
DEFAULT_FINAL_SETTLE_DELAY_SECONDS = 1


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def env_int(name: str, default: int) -> int:
    value = env(name, str(default))
    return int(value)


def extract_data(response: Any) -> Any:
    if not isinstance(response, dict) or "data" not in response:
        raise RuntimeError(f"unexpected response payload: {response!r}")
    return response["data"]


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
        if action not in {"approve", "reject", "request_changes"}:
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


def _workflow_events(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _workflow_tasks(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = workflow.get("tasks", [])
    return tasks if isinstance(tasks, list) else []


def _completed_work_item_count(work_items_snapshot: Any) -> int:
    return sum(1 for item in _work_items(work_items_snapshot) if item.get("column_id") == "done")


def _open_work_item_count(work_items_snapshot: Any) -> int:
    return sum(1 for item in _work_items(work_items_snapshot) if item.get("column_id") != "done")


def _workspace_host_directory_root(workspace: dict[str, Any]) -> Path | None:
    settings = workspace.get("settings")
    if not isinstance(settings, dict):
        return None
    if settings.get("workspace_storage_type") != "host_directory":
        return None
    storage = settings.get("workspace_storage")
    if not isinstance(storage, dict):
        return None
    host_path = storage.get("host_path")
    if not isinstance(host_path, str) or host_path.strip() == "":
        return None
    return Path(host_path.strip())


def workflow_is_fully_terminal(workflow: dict[str, Any]) -> bool:
    if workflow.get("state") not in TERMINAL_STATES:
        return False
    return all(
        isinstance(task, dict) and task.get("state") in TERMINAL_STATES
        for task in _workflow_tasks(workflow)
    )


def refresh_terminal_workflow_snapshot(
    client: ApiClient,
    *,
    workflow_id: str,
    workflow: dict[str, Any],
    max_attempts: int,
    delay_seconds: int,
) -> dict[str, Any]:
    latest = workflow
    if latest.get("state") not in TERMINAL_STATES:
        return latest
    for attempt in range(max_attempts):
        if workflow_is_fully_terminal(latest):
            return latest
        if attempt > 0 or delay_seconds > 0:
            time.sleep(delay_seconds)
        latest = extract_data(
            client.request(
                "GET",
                f"/api/v1/workflows/{workflow_id}",
                expected=(200,),
                label="workflows.get.final",
            )
        )
    return latest


def _playbook_pool_status(fleet: Any, *, playbook_id: str) -> dict[str, Any] | None:
    data = _nested_data(fleet)
    if not isinstance(data, dict):
        return None
    pools = data.get("by_playbook_pool")
    if not isinstance(pools, list):
        return None
    specialist_fallback: dict[str, Any] | None = None
    for item in pools:
        if not isinstance(item, dict):
            continue
        if item.get("playbook_id") == playbook_id:
            return item
        if item.get("playbook_id") == "specialist" and item.get("pool_kind") == "specialist":
            specialist_fallback = item
    return specialist_fallback


def update_fleet_peaks(peaks: dict[str, int], fleet: Any, *, playbook_id: str) -> None:
    pool = _playbook_pool_status(fleet, playbook_id=playbook_id)
    if pool is None:
        return
    for field, peak_key in (
        ("running", "peak_running"),
        ("executing", "peak_executing"),
        ("active_workflows", "peak_active_workflows"),
    ):
        value = pool.get(field)
        if isinstance(value, int):
            peaks[peak_key] = max(peaks.get(peak_key, 0), value)


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


def evaluate_expectations(
    expectations: dict[str, Any],
    *,
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    workspace: dict[str, Any],
    artifacts: Any,
    approval_actions: list[dict[str, Any]],
    events: Any | None = None,
    fleet: Any | None = None,
    playbook_id: str = "",
    fleet_peaks: dict[str, int] | None = None,
    efficiency: dict[str, Any] | None = None,
) -> dict[str, Any]:
    failures: list[str] = []
    checks: list[dict[str, Any]] = []

    expected_state = expectations.get("state")
    if expected_state is not None:
        actual_state = workflow.get("state")
        passed = actual_state == expected_state
        checks.append({"name": "workflow.state", "passed": passed, "expected": expected_state, "actual": actual_state})
        if not passed:
            failures.append(f"expected workflow state {expected_state!r}, got {actual_state!r}")

    workflow_field_expectations = expectations.get("workflow_fields", {})
    if isinstance(workflow_field_expectations, dict):
        for field_name, expected_value in workflow_field_expectations.items():
            actual_value = workflow.get(field_name)
            passed = actual_value == expected_value
            checks.append(
                {
                    "name": f"workflow_fields.{field_name}",
                    "passed": passed,
                    "expected": expected_value,
                    "actual": actual_value,
                }
            )
            if not passed:
                failures.append(
                    f"expected workflow field {field_name!r} to equal {expected_value!r}, got {actual_value!r}"
                )

    work_item_expectations = expectations.get("work_items", {})
    if isinstance(work_item_expectations, dict) and work_item_expectations.get("all_terminal"):
        items = _work_items(work_items)
        non_terminal = [item.get("id") for item in items if item.get("column_id") != "done"]
        passed = len(non_terminal) == 0
        checks.append({"name": "work_items.all_terminal", "passed": passed, "non_terminal_ids": non_terminal})
        if not passed:
            failures.append(f"expected all work items to be terminal, found non-terminal items: {non_terminal}")
    if isinstance(work_item_expectations, dict) and "min_count" in work_item_expectations:
        items = _work_items(work_items)
        minimum = int(work_item_expectations["min_count"])
        actual = len(items)
        passed = actual >= minimum
        checks.append(
            {
                "name": "work_items.min_count",
                "passed": passed,
                "expected_min_count": minimum,
                "actual_count": actual,
            }
        )
        if not passed:
            failures.append(f"expected at least {minimum} work items, found {actual}")

    board_expectations = expectations.get("board", {})
    if isinstance(board_expectations, dict) and "blocked_count" in board_expectations:
        blocked_items = 0
        for column in _board_columns(board):
            if column.get("id") == "blocked":
                work_items_list = column.get("work_items", [])
                if isinstance(work_items_list, list):
                    blocked_items += len(work_items_list)
        expected_blocked_count = int(board_expectations["blocked_count"])
        passed = blocked_items == expected_blocked_count
        checks.append(
            {
                "name": "board.blocked_count",
                "passed": passed,
                "expected": expected_blocked_count,
                "actual": blocked_items,
            }
        )
        if not passed:
            failures.append(f"expected blocked_count={expected_blocked_count}, got {blocked_items}")

    memory_expectations = expectations.get("memory", [])
    if isinstance(memory_expectations, list):
        memory = workspace.get("memory", {})
        if not isinstance(memory, dict):
            memory = {}
        for entry in memory_expectations:
            if not isinstance(entry, dict):
                continue
            key = entry.get("key")
            if not isinstance(key, str) or key.strip() == "":
                continue
            expected_value = entry.get("value")
            actual_value = memory.get(key)
            passed = key in memory and (expected_value is None or actual_value == expected_value)
            checks.append(
                {
                    "name": f"memory.{key}",
                    "passed": passed,
                    "expected": expected_value,
                    "actual": actual_value,
                }
            )
            if not passed:
                failures.append(f"expected workspace memory key {key!r} with value {expected_value!r}, got {actual_value!r}")

    artifact_expectations = expectations.get("artifacts", [])
    if isinstance(artifact_expectations, list):
        items = _artifacts(artifacts)
        for entry in artifact_expectations:
            if not isinstance(entry, dict):
                continue
            pattern = entry.get("logical_path_pattern") or entry.get("name_pattern")
            if not isinstance(pattern, str) or pattern.strip() == "":
                continue
            minimum = int(entry.get("min_count", 1))
            matches = [
                item
                for item in items
                if isinstance(item, dict) and re.search(pattern, str(item.get("logical_path") or item.get("file_name") or ""))
            ]
            passed = len(matches) >= minimum
            checks.append(
                {
                    "name": f"artifacts:{pattern}",
                    "passed": passed,
                    "expected_min_count": minimum,
                    "actual_count": len(matches),
                }
            )
            if not passed:
                failures.append(
                    f"expected at least {minimum} artifacts matching {pattern!r}, found {len(matches)}"
                )

    host_file_expectations = expectations.get("host_files", [])
    if isinstance(host_file_expectations, list):
        host_root = _workspace_host_directory_root(workspace)
        for entry in host_file_expectations:
            if not isinstance(entry, dict):
                continue
            relative_path = entry.get("path")
            if not isinstance(relative_path, str) or relative_path.strip() == "":
                continue
            check_name = f"host_files.{relative_path}"
            if host_root is None:
                checks.append({"name": check_name, "passed": False, "reason": "host_directory_root_missing"})
                failures.append("expected host-directory workspace settings with a host_path for host_files checks")
                continue
            target = host_root / relative_path
            exists = target.is_file()
            passed = exists
            actual_content = None
            if exists and "contains" in entry:
                actual_content = target.read_text(encoding="utf-8")
                passed = str(entry["contains"]) in actual_content
            checks.append(
                {
                    "name": check_name,
                    "passed": passed,
                    "path": str(target),
                }
            )
            if not exists:
                failures.append(f"expected host file {target} to exist")
            elif "contains" in entry and not passed:
                failures.append(f"expected host file {target} to contain {entry['contains']!r}")

    workflow_task_expectations = expectations.get("workflow_tasks", {})
    if isinstance(workflow_task_expectations, dict):
        workflow_tasks = [task for task in _workflow_tasks(workflow) if isinstance(task, dict)]
        non_orchestrator_tasks = [
            task for task in workflow_tasks if not bool(task.get("is_orchestrator_task"))
        ]
        if "min_non_orchestrator_count" in workflow_task_expectations:
            minimum = int(workflow_task_expectations["min_non_orchestrator_count"])
            actual = len(non_orchestrator_tasks)
            passed = actual >= minimum
            checks.append(
                {
                    "name": "workflow_tasks.min_non_orchestrator_count",
                    "passed": passed,
                    "expected_min_count": minimum,
                    "actual_count": actual,
                }
            )
            if not passed:
                failures.append(f"expected at least {minimum} non-orchestrator tasks, found {actual}")

    fleet_expectations = expectations.get("fleet", {})
    if isinstance(fleet_expectations, dict):
        pool_expectations = fleet_expectations.get("playbook_pool", {})
        if isinstance(pool_expectations, dict) and pool_expectations:
            pool = _playbook_pool_status(fleet, playbook_id=playbook_id)
            if pool is None:
                checks.append(
                    {
                        "name": "fleet.playbook_pool.present",
                        "passed": False,
                        "playbook_id": playbook_id,
                    }
                )
                failures.append(f"expected fleet pool entry for playbook {playbook_id!r}")
            else:
                for field in ("max_runtimes", "active_workflows"):
                    if field not in pool_expectations:
                        continue
                    expected_value = int(pool_expectations[field])
                    actual_value = int(pool.get(field, 0))
                    passed = actual_value == expected_value
                    checks.append(
                        {
                            "name": f"fleet.playbook_pool.{field}",
                            "passed": passed,
                            "expected": expected_value,
                            "actual": actual_value,
                        }
                    )
                    if not passed:
                        failures.append(
                            f"expected fleet playbook pool {field}={expected_value}, got {actual_value}"
                        )

                peaks = fleet_peaks or {}
                for expectation_key, peak_key in (
                    ("peak_running_lte", "peak_running"),
                    ("peak_executing_lte", "peak_executing"),
                    ("peak_active_workflows_lte", "peak_active_workflows"),
                ):
                    if expectation_key not in pool_expectations:
                        continue
                    expected_max = int(pool_expectations[expectation_key])
                    actual_peak = int(peaks.get(peak_key, 0))
                    passed = actual_peak <= expected_max
                    checks.append(
                        {
                            "name": f"fleet.playbook_pool.{expectation_key}",
                            "passed": passed,
                            "expected_max": expected_max,
                            "actual": actual_peak,
                        }
                    )
                    if not passed:
                        failures.append(
                            f"expected fleet playbook pool {peak_key} <= {expected_max}, got {actual_peak}"
                        )

                for expectation_key, peak_key in (
                    ("peak_running_gte", "peak_running"),
                    ("peak_executing_gte", "peak_executing"),
                    ("peak_active_workflows_gte", "peak_active_workflows"),
                ):
                    if expectation_key not in pool_expectations:
                        continue
                    expected_min = int(pool_expectations[expectation_key])
                    actual_peak = int(peaks.get(peak_key, 0))
                    passed = actual_peak >= expected_min
                    checks.append(
                        {
                            "name": f"fleet.playbook_pool.{expectation_key}",
                            "passed": passed,
                            "expected_min": expected_min,
                            "actual": actual_peak,
                        }
                    )
                    if not passed:
                        failures.append(
                            f"expected fleet playbook pool {peak_key} >= {expected_min}, got {actual_peak}"
                        )

    approval_action_expectations = expectations.get("approval_actions", [])
    if isinstance(approval_action_expectations, list):
        for entry in approval_action_expectations:
            if not isinstance(entry, dict):
                continue
            matched = any(
                all(actual.get(key) == expected for key, expected in entry.items())
                for actual in approval_actions
                if isinstance(actual, dict)
            )
            checks.append({"name": f"approval_actions:{entry}", "passed": matched})
            if not matched:
                failures.append(f"expected approval action {entry!r} was not observed")

    gate_rework_sequences = expectations.get("gate_rework_sequences", [])
    if isinstance(gate_rework_sequences, list):
        event_list = sorted(
            _workflow_events(events),
            key=lambda entry: _parse_timestamp(entry.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        )
        workflow_tasks = _workflow_tasks(workflow)
        for entry in gate_rework_sequences:
            if not isinstance(entry, dict):
                continue
            stage_name = entry.get("stage_name")
            if not isinstance(stage_name, str) or stage_name.strip() == "":
                continue
            request_action = str(entry.get("request_action", "request_changes"))
            resume_action = str(entry.get("resume_action", "approve"))
            required_event_type = str(entry.get("required_event_type", "task.handoff_submitted"))
            required_role = entry.get("required_role")
            require_non_orchestrator = bool(entry.get("require_non_orchestrator", True))

            request_event = next(
                (
                    actual
                    for actual in event_list
                    if actual.get("type") == f"stage.gate.{request_action}"
                    and isinstance(actual.get("data"), dict)
                    and actual["data"].get("stage_name") == stage_name
                ),
                None,
            )
            request_index = event_list.index(request_event) if request_event in event_list else None
            resume_event = next(
                (
                    actual
                    for index, actual in enumerate(event_list)
                    if request_index is not None
                    and index > request_index
                    and actual.get("type") == f"stage.gate.{resume_action}"
                    and isinstance(actual.get("data"), dict)
                    and actual["data"].get("stage_name") == stage_name
                ),
                None,
            )
            resume_index = event_list.index(resume_event) if resume_event in event_list else None

            matched = False
            if request_index is not None and resume_index is not None:
                for actual in event_list[request_index + 1 : resume_index]:
                    data = actual.get("data")
                    if not isinstance(data, dict):
                        continue
                    if actual.get("type") != required_event_type:
                        continue
                    if data.get("stage_name") != stage_name:
                        continue
                    role = data.get("role")
                    if require_non_orchestrator and role == "orchestrator":
                        continue
                    if required_role is not None and role != required_role:
                        continue
                    matched = True
                    break
            if not matched and request_event is not None and resume_event is not None:
                request_at = _parse_timestamp(request_event.get("created_at"))
                resume_at = _parse_timestamp(resume_event.get("created_at"))
                if request_at is not None and resume_at is not None:
                    for task in workflow_tasks:
                        if not isinstance(task, dict):
                            continue
                        if task.get("stage_name") != stage_name:
                            continue
                        role = task.get("role")
                        if require_non_orchestrator and role == "orchestrator":
                            continue
                        if required_role is not None and role != required_role:
                            continue
                        completed_at = _parse_timestamp(task.get("completed_at"))
                        if completed_at is None:
                            continue
                        if request_at < completed_at < resume_at:
                            matched = True
                            break

            check_name = (
                f"gate_rework_sequences:{stage_name}:{request_action}->{required_event_type}->{resume_action}"
            )
            checks.append({"name": check_name, "passed": matched})
            if not matched:
                failures.append(
                    f"expected {required_event_type!r} for stage {stage_name!r} between "
                    f"stage.gate.{request_action} and stage.gate.{resume_action}"
                )

    efficiency_expectations = expectations.get("efficiency", {})
    if isinstance(efficiency_expectations, dict) and efficiency_expectations:
        efficiency_checks, efficiency_failures = evaluate_efficiency_expectations(
            efficiency_expectations,
            efficiency,
        )
        checks.extend(efficiency_checks)
        failures.extend(efficiency_failures)

    return {
        "passed": len(failures) == 0,
        "failures": failures,
        "checks": checks,
        "approval_actions": approval_actions,
    }


def login(client: ApiClient, admin_api_key: str) -> str:
    response = client.request(
        "POST",
        "/api/v1/auth/login",
        payload={"api_key": admin_api_key},
        expected=(200,),
        label="auth.login",
    )
    data = extract_data(response)
    token = data.get("token")
    if not isinstance(token, str) or token.strip() == "":
        raise RuntimeError("auth login did not return a token")
    return token


def build_workflow_create_payload(
    *,
    playbook_id: str,
    workspace_id: str,
    workflow_name: str,
    scenario_name: str,
    workflow_goal: str,
    workflow_parameters: dict[str, Any] | None = None,
    workflow_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    parameters = {
        "goal": workflow_goal,
        "scenario_name": scenario_name,
    }
    if workflow_parameters:
        parameters.update(workflow_parameters)
    return {
        "playbook_id": playbook_id,
        "workspace_id": workspace_id,
        "name": workflow_name,
        "parameters": parameters,
        "metadata": {
            **({} if workflow_metadata is None else workflow_metadata),
            "live_test": {"scenario_name": scenario_name},
        },
    }


def _render_template_value(value: Any, *, index: int, scenario_name: str, workflow_id: str) -> Any:
    if isinstance(value, str):
        return value.format(index=index, scenario_name=scenario_name, workflow_id=workflow_id)
    if isinstance(value, list):
        return [
            _render_template_value(item, index=index, scenario_name=scenario_name, workflow_id=workflow_id)
            for item in value
        ]
    if isinstance(value, dict):
        return {
            key: _render_template_value(item, index=index, scenario_name=scenario_name, workflow_id=workflow_id)
            for key, item in value.items()
        }
    return value


def build_create_work_item_payloads(
    action: dict[str, Any],
    *,
    workflow_id: str,
    scenario_name: str,
) -> list[dict[str, Any]]:
    count = int(action.get("count", 1))
    index_start = int(action.get("index_start", 1))
    if count <= 0:
        raise RuntimeError("create_work_items action count must be positive")

    title_template = action.get("title_template")
    if not isinstance(title_template, str) or title_template.strip() == "":
        raise RuntimeError("create_work_items action title_template is required")

    payloads: list[dict[str, Any]] = []
    for index in range(index_start, index_start + count):
        payload: dict[str, Any] = {
            "request_id": _render_template_value(
                action.get("request_id_template", f"live-test-{scenario_name}-work-item-{index}"),
                index=index,
                scenario_name=scenario_name,
                workflow_id=workflow_id,
            ),
            "title": _render_template_value(
                title_template,
                index=index,
                scenario_name=scenario_name,
                workflow_id=workflow_id,
            ),
        }
        for source_key, target_key in (
            ("parent_work_item_id", "parent_work_item_id"),
            ("stage_name", "stage_name"),
            ("goal_template", "goal"),
            ("acceptance_criteria_template", "acceptance_criteria"),
            ("column_id", "column_id"),
            ("owner_role", "owner_role"),
            ("priority", "priority"),
            ("notes_template", "notes"),
            ("metadata", "metadata"),
        ):
            value = action.get(source_key)
            if value is None:
                continue
            payload[target_key] = _render_template_value(
                value,
                index=index,
                scenario_name=scenario_name,
                workflow_id=workflow_id,
            )
        payloads.append(payload)
    return payloads


def workflow_action_wait_conditions_met(
    action: dict[str, Any],
    *,
    workflow: dict[str, Any],
    work_items_snapshot: Any,
) -> bool:
    wait_for = action.get("wait_for", {})
    if not isinstance(wait_for, dict) or not wait_for:
        return True

    expected_workflow_state = wait_for.get("workflow_state")
    if expected_workflow_state is not None and workflow.get("state") != expected_workflow_state:
        return False

    if "completed_work_items_min" in wait_for:
        if _completed_work_item_count(work_items_snapshot) < int(wait_for["completed_work_items_min"]):
            return False

    if "total_work_items_min" in wait_for:
        if len(_work_items(work_items_snapshot)) < int(wait_for["total_work_items_min"]):
            return False

    if "open_work_items_max" in wait_for:
        if _open_work_item_count(work_items_snapshot) > int(wait_for["open_work_items_max"]):
            return False

    if "all_work_items_terminal" in wait_for:
        expected = bool(wait_for["all_work_items_terminal"])
        actual = _open_work_item_count(work_items_snapshot) == 0
        if actual != expected:
            return False

    return True


def dispatch_workflow_actions(
    client: ApiClient,
    *,
    workflow_id: str,
    scenario_name: str,
    actions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    executed: list[dict[str, Any]] = []
    for action in actions:
        action_type = str(action.get("type") or "").strip()
        if action_type == "":
            raise RuntimeError("scenario action type is required")
        if action_type != "create_work_items":
            raise RuntimeError(f"unsupported scenario action type: {action_type}")

        payloads = build_create_work_item_payloads(
            action,
            workflow_id=workflow_id,
            scenario_name=scenario_name,
        )
        dispatch_mode = str(action.get("dispatch", "serial")).strip()
        if dispatch_mode not in {"serial", "parallel"}:
            raise RuntimeError(f"unsupported create_work_items dispatch mode: {dispatch_mode}")

        def create_work_item(payload: dict[str, Any]) -> dict[str, Any]:
            return extract_data(
                client.request(
                    "POST",
                    f"/api/v1/workflows/{workflow_id}/work-items",
                    payload=payload,
                    expected=(201,),
                    label=f"workflows.work-items.create:{payload['request_id']}",
                )
            )

        if dispatch_mode == "parallel" and len(payloads) > 1:
            max_workers = int(action.get("max_workers", len(payloads)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                responses = list(executor.map(create_work_item, payloads))
        else:
            responses = [create_work_item(payload) for payload in payloads]

        executed.append(
            {
                "type": action_type,
                "dispatch": dispatch_mode,
                "count": len(payloads),
                "responses": responses,
            }
        )
    return executed


def dispatch_ready_workflow_actions(
    client: ApiClient,
    *,
    workflow_id: str,
    scenario_name: str,
    actions: list[dict[str, Any]],
    next_action_index: int,
    workflow: dict[str, Any],
    work_items_snapshot: Any,
) -> tuple[int, list[dict[str, Any]]]:
    executed: list[dict[str, Any]] = []
    current_index = next_action_index
    while current_index < len(actions):
        action = actions[current_index]
        if not workflow_action_wait_conditions_met(
            action,
            workflow=workflow,
            work_items_snapshot=work_items_snapshot,
        ):
            break
        executed.extend(
            dispatch_workflow_actions(
                client,
                workflow_id=workflow_id,
                scenario_name=scenario_name,
                actions=[action],
            )
        )
        current_index += 1
    return current_index, executed


def collect_workflow_events(client: ApiClient, *, workflow_id: str, per_page: int = 100) -> dict[str, Any]:
    after: str | None = None
    collected: list[dict[str, Any]] = []

    while True:
        path = f"/api/v1/workflows/{workflow_id}/events?limit={per_page}"
        if after:
            path = f"{path}&after={after}"

        snapshot = client.best_effort_request(
            "GET",
            path,
            expected=(200,),
            label="workflows.events",
        )
        if not snapshot.get("ok"):
            return snapshot

        payload = snapshot.get("data")
        data = extract_data(payload)
        page_items = data if isinstance(data, list) else []
        collected.extend(item for item in page_items if isinstance(item, dict))

        meta = payload.get("meta", {}) if isinstance(payload, dict) else {}
        has_more = bool(meta.get("has_more"))
        next_after = meta.get("next_after")
        if not has_more or not isinstance(next_after, str) or next_after.strip() == "":
            return {
                "ok": True,
                "data": {
                    "data": collected,
                    "meta": {
                        "has_more": False,
                        "next_after": None,
                    },
                },
            }
        after = next_after


def build_run_result_payload(
    *,
    workflow_id: str,
    final_state: str,
    timed_out: bool,
    poll_iterations: int,
    scenario_name: str,
    approval_mode: str,
    provider_auth_mode: str,
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    events: Any,
    approvals: Any,
    approval_actions: list[dict[str, Any]],
    workflow_actions: list[dict[str, Any]],
    workspace: dict[str, Any],
    artifacts: Any,
    fleet: Any,
    fleet_peaks: dict[str, int],
    verification: dict[str, Any] | None = None,
    execution_logs: Any | None = None,
    efficiency: dict[str, Any] | None = None,
) -> dict[str, Any]:
    verification_payload = {} if verification is None else verification
    efficiency_payload = {} if efficiency is None else efficiency
    specialist_teardown = efficiency_payload.get("specialist_teardown")
    if not isinstance(specialist_teardown, dict):
        specialist_teardown = {}
    brief_proof = build_brief_proof(workflow=workflow, logs=execution_logs)
    return {
        "workflow_id": workflow_id,
        "state": final_state,
        "workflow_state": final_state,
        "terminal": final_state in TERMINAL_STATES,
        "timed_out": timed_out,
        "poll_iterations": poll_iterations,
        "scenario": scenario_name,
        "scenario_name": scenario_name,
        "approval_mode": approval_mode,
        "provider_auth_mode": provider_auth_mode,
        "workflow": workflow,
        "board": board,
        "work_items": work_items,
        "events": events,
        "approvals": approvals,
        "approval_actions": approval_actions,
        "workflow_actions": workflow_actions,
        "workspace": workspace,
        "artifacts": artifacts,
        "fleet": fleet,
        "fleet_peaks": fleet_peaks,
        "execution_logs": execution_logs,
        "efficiency": efficiency_payload,
        "verification": verification_payload,
        "verification_passed": bool(verification_payload.get("passed")),
        "harness_failure": False,
        "workflow_duration_seconds": efficiency_payload.get("workflow_duration_seconds"),
        "total_llm_turns": efficiency_payload.get("total_llm_turns"),
        "total_tool_steps": efficiency_payload.get("total_tool_steps"),
        "total_bursts": efficiency_payload.get("total_bursts"),
        "orchestrator_max_llm_turns": efficiency_payload.get("orchestrator_max_llm_turns"),
        "non_orchestrator_max_llm_turns": efficiency_payload.get("non_orchestrator_max_llm_turns"),
        "specialist_teardown_lag_seconds": specialist_teardown.get("max_lag_seconds"),
        "brief_proof": brief_proof,
    }


def build_brief_proof(*, workflow: dict[str, Any], logs: Any) -> dict[str, Any]:
    task_roles = {
        str(task.get("id")): str(task.get("role") or "").strip()
        for task in _workflow_tasks(workflow)
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    task_orchestrator_flags = {
        str(task.get("id")): bool(task.get("is_orchestrator_task"))
        for task in _workflow_tasks(workflow)
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    task_entries: list[dict[str, Any]] = []
    seen_task_ids: set[str] = set()

    for row in execution_log_rows(logs):
        if row.get("operation") != "llm.chat_stream" or row.get("status") != "started":
            continue
        task_id = row.get("task_id")
        if not isinstance(task_id, str) or task_id.strip() == "" or task_id in seen_task_ids:
            continue
        if task_orchestrator_flags.get(task_id):
            continue
        payload = row.get("payload")
        if not isinstance(payload, dict):
            continue
        messages = payload.get("messages")
        if not isinstance(messages, list):
            continue
        system_messages = [
            str(message.get("content") or "")
            for message in messages
            if isinstance(message, dict) and message.get("role") == "system"
        ]
        execution_brief_message = next(
            (
                str(message.get("content") or "")
                for message in messages
                if isinstance(message, dict)
                and message.get("role") == "user"
                and "Authoritative specialist execution brief" in str(message.get("content") or "")
            ),
            "",
        )
        task_entries.append(
            {
                "task_id": task_id,
                "role": task_roles.get(task_id) or None,
                "execution_brief_present": bool(execution_brief_message),
                "execution_brief_path": "/workspace/context/execution-brief.json",
                "execution_brief_excerpt": truncate(execution_brief_message, 400) if execution_brief_message else None,
                "system_prompt_contains_workflow_brief": any(
                    "## Workflow Brief" in message for message in system_messages
                ),
                "system_prompt_contains_current_focus": any(
                    "## Current Focus" in message for message in system_messages
                ),
                "system_prompt_contains_predecessor_context": any(
                    "## Predecessor Context" in message for message in system_messages
                ),
            }
        )
        seen_task_ids.add(task_id)

    return {
        "task_count": len(task_entries),
        "tasks": task_entries,
    }


def execution_log_rows(logs: Any) -> list[dict[str, Any]]:
    if isinstance(logs, list):
        return [row for row in logs if isinstance(row, dict)]
    if isinstance(logs, dict):
        rows = logs.get("data", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def main() -> None:
    base_url = env("PLATFORM_API_BASE_URL", required=True)
    trace_dir = env("LIVE_TEST_SCENARIO_TRACE_DIR", required=True)
    admin_api_key = env("DEFAULT_ADMIN_API_KEY", required=True)
    bootstrap_context_file = env("LIVE_TEST_BOOTSTRAP_CONTEXT_FILE", required=True)
    scenario_file = env("LIVE_TEST_SCENARIO_FILE")
    scenario = load_scenario(scenario_file) if scenario_file else None
    workflow_name = scenario["workflow"]["name"] if scenario else env("LIVE_TEST_WORKFLOW_NAME", required=True)
    workflow_goal = scenario["workflow"]["goal"] if scenario else env("LIVE_TEST_WORKFLOW_GOAL", required=True)
    scenario_name = scenario["name"] if scenario else env("LIVE_TEST_SCENARIO_NAME", required=True)
    approval_mode = "scripted" if scenario and scenario["approvals"] else env("LIVE_TEST_APPROVAL_MODE", "none")
    timeout_seconds = scenario["timeout_seconds"] if scenario else env_int("LIVE_TEST_WORKFLOW_TIMEOUT_SECONDS", 1800)
    poll_interval_seconds = scenario["poll_interval_seconds"] if scenario else env_int("LIVE_TEST_POLL_INTERVAL_SECONDS", 10)

    bootstrap_context = read_json(bootstrap_context_file)
    workspace_id = env("LIVE_TEST_WORKSPACE_ID", bootstrap_context["workspace_id"], required=True)
    playbook_id = env("LIVE_TEST_PLAYBOOK_ID", bootstrap_context["playbook_id"], required=True)
    provider_auth_mode = env(
        "LIVE_TEST_PROVIDER_AUTH_MODE",
        str(bootstrap_context.get("provider_auth_mode") or "").strip(),
        required=True,
    )
    final_settle_attempts = env_int("LIVE_TEST_FINAL_SETTLE_ATTEMPTS", DEFAULT_FINAL_SETTLE_ATTEMPTS)
    final_settle_delay_seconds = env_int(
        "LIVE_TEST_FINAL_SETTLE_DELAY_SECONDS",
        DEFAULT_FINAL_SETTLE_DELAY_SECONDS,
    )
    action_plan = [] if scenario is None else scenario["actions"]
    expectation_plan = {} if scenario is None else scenario["expect"]

    trace = TraceRecorder(trace_dir)
    public_client = ApiClient(base_url, trace)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token)

    created = extract_data(
        client.request(
            "POST",
            "/api/v1/workflows",
            payload=build_workflow_create_payload(
                playbook_id=playbook_id,
                workspace_id=workspace_id,
                workflow_name=workflow_name,
                scenario_name=scenario_name,
                workflow_goal=workflow_goal,
                workflow_parameters={} if scenario is None else scenario["workflow"]["parameters"],
                workflow_metadata={} if scenario is None else scenario["workflow"]["metadata"],
            ),
            expected=(201,),
            label="workflows.create",
        )
    )

    workflow_id = created["id"]
    next_action_index, workflow_actions = dispatch_ready_workflow_actions(
        client,
        workflow_id=workflow_id,
        scenario_name=scenario_name,
        actions=action_plan,
        next_action_index=0,
        workflow=created,
        work_items_snapshot={"ok": True, "data": []},
    )
    deadline = time.time() + timeout_seconds
    latest_workflow = created
    latest_approvals: dict[str, Any] | None = None
    poll_iterations = 0
    timed_out = True
    approved_gate_ids: set[str] = set()
    approval_actions: list[dict[str, Any]] = []
    consumed_decisions: set[int] = set()
    fleet_peaks: dict[str, int] = {
        "peak_running": 0,
        "peak_executing": 0,
        "peak_active_workflows": 0,
    }
    latest_fleet: Any = {}

    while time.time() < deadline:
        poll_iterations += 1
        latest_workflow = extract_data(
            client.request(
                "GET",
                f"/api/v1/workflows/{workflow_id}",
                expected=(200,),
                label="workflows.get",
            )
        )

        work_items_for_actions = None
        if next_action_index < len(action_plan):
            work_items_for_actions = client.best_effort_request(
                "GET",
                f"/api/v1/workflows/{workflow_id}/work-items",
                expected=(200,),
                label="workflows.work-items.actions",
            )
            next_action_index, ready_actions = dispatch_ready_workflow_actions(
                client,
                workflow_id=workflow_id,
                scenario_name=scenario_name,
                actions=action_plan,
                next_action_index=next_action_index,
                workflow=latest_workflow,
                work_items_snapshot=work_items_for_actions,
            )
            if ready_actions:
                workflow_actions.extend(ready_actions)
                continue

        if latest_workflow.get("state") in TERMINAL_STATES:
            timed_out = False
            break
        latest_fleet = client.best_effort_request(
            "GET",
            "/api/v1/fleet/status",
            expected=(200,),
            label="fleet.status",
        )
        if latest_fleet.get("ok"):
            update_fleet_peaks(fleet_peaks, latest_fleet.get("data"), playbook_id=playbook_id)
        latest_approvals = extract_data(
            client.request(
                "GET",
                "/api/v1/approvals",
                expected=(200,),
                label="approvals.list",
            )
        )
        actions = process_workflow_approvals(
            client,
            latest_approvals,
            workflow_id=workflow_id,
            scenario_name=scenario_name,
            approved_gate_ids=approved_gate_ids,
            approval_mode=approval_mode,
            consumed_decisions=consumed_decisions,
            approval_decisions=[] if scenario is None else scenario["approvals"],
        )
        if actions:
            approval_actions.extend(actions)
            continue

        if (
            next_action_index == len(action_plan)
            and latest_workflow.get("state") not in TERMINAL_STATES
            and expectation_plan.get("state") not in TERMINAL_STATES
        ):
            board_snapshot = client.best_effort_request(
                "GET",
                f"/api/v1/workflows/{workflow_id}/board",
                expected=(200,),
                label="workflows.board.progress",
            )
            work_items_snapshot = (
                work_items_for_actions
                if work_items_for_actions is not None
                else client.best_effort_request(
                    "GET",
                    f"/api/v1/workflows/{workflow_id}/work-items",
                    expected=(200,),
                    label="workflows.work-items.progress",
                )
            )
            workspace_snapshot = extract_data(
                client.request(
                    "GET",
                    f"/api/v1/workspaces/{workspace_id}",
                    expected=(200,),
                    label="workspaces.get.progress",
                )
            )
            artifacts_snapshot = client.best_effort_request(
                "GET",
                f"/api/v1/workspaces/{workspace_id}/artifacts",
                expected=(200,),
                label="workspaces.artifacts.progress",
            )
            progress_verification = evaluate_expectations(
                expectation_plan,
                workflow=latest_workflow,
                board=board_snapshot,
                work_items=work_items_snapshot,
                workspace=workspace_snapshot,
                artifacts=artifacts_snapshot,
                approval_actions=approval_actions,
                events={"ok": True, "data": []},
                fleet=latest_fleet,
                playbook_id=playbook_id,
                fleet_peaks=fleet_peaks,
                efficiency=None,
            )
            if progress_verification["passed"]:
                timed_out = False
                break
        time.sleep(poll_interval_seconds)

    latest_workflow = refresh_terminal_workflow_snapshot(
        client,
        workflow_id=workflow_id,
        workflow=latest_workflow,
        max_attempts=final_settle_attempts,
        delay_seconds=final_settle_delay_seconds,
    )

    board_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/board",
        expected=(200,),
        label="workflows.board",
    )
    work_items_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/work-items",
        expected=(200,),
        label="workflows.work-items",
    )
    events_snapshot = collect_workflow_events(client, workflow_id=workflow_id)
    approvals_snapshot = client.best_effort_request(
        "GET",
        "/api/v1/approvals",
        expected=(200,),
        label="approvals.final",
    )
    workspace_snapshot = extract_data(
        client.request(
            "GET",
            f"/api/v1/workspaces/{workspace_id}",
            expected=(200,),
            label="workspaces.get",
        )
    )
    artifacts_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workspaces/{workspace_id}/artifacts",
        expected=(200,),
        label="workspaces.artifacts",
    )
    latest_fleet = client.best_effort_request(
        "GET",
        "/api/v1/fleet/status",
        expected=(200,),
        label="fleet.status.final",
    )
    if latest_fleet.get("ok"):
        update_fleet_peaks(fleet_peaks, latest_fleet.get("data"), playbook_id=playbook_id)
    execution_logs_snapshot = collect_execution_logs(client, workflow_id=workflow_id)
    efficiency_summary = summarize_efficiency(
        workflow=latest_workflow,
        logs=execution_logs_snapshot,
        events=events_snapshot,
        approval_actions=approval_actions,
    )

    final_state = latest_workflow.get("state")
    verification = evaluate_expectations(
        expectation_plan,
        workflow=latest_workflow,
        board=board_snapshot,
        work_items=work_items_snapshot,
        workspace=workspace_snapshot,
        artifacts=artifacts_snapshot,
        approval_actions=approval_actions,
        events=events_snapshot,
        fleet=latest_fleet,
        playbook_id=playbook_id,
        fleet_peaks=fleet_peaks,
        efficiency=efficiency_summary,
    )
    print(
        json.dumps(
            build_run_result_payload(
                workflow_id=workflow_id,
                final_state=final_state,
                timed_out=timed_out,
                poll_iterations=poll_iterations,
                scenario_name=scenario_name,
                approval_mode=approval_mode,
                provider_auth_mode=provider_auth_mode,
                workflow=latest_workflow,
                board=board_snapshot,
                work_items=work_items_snapshot,
                events=events_snapshot,
                approvals=approvals_snapshot,
                approval_actions=approval_actions,
                workflow_actions=workflow_actions,
                workspace=workspace_snapshot,
                artifacts=artifacts_snapshot,
                fleet=latest_fleet,
                fleet_peaks=fleet_peaks,
                execution_logs=execution_logs_snapshot,
                efficiency=efficiency_summary,
                verification=verification,
            )
        )
    )
    if not verification["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
