#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from live_test_api import ApiClient, TraceRecorder, read_json
from scenario_config import load_scenario

TERMINAL_STATES = {"completed", "failed", "cancelled"}


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

    work_item_expectations = expectations.get("work_items", {})
    if isinstance(work_item_expectations, dict) and work_item_expectations.get("all_terminal"):
        items = _work_items(work_items)
        non_terminal = [item.get("id") for item in items if item.get("column_id") != "done"]
        passed = len(non_terminal) == 0
        checks.append({"name": "work_items.all_terminal", "passed": passed, "non_terminal_ids": non_terminal})
        if not passed:
            failures.append(f"expected all work items to be terminal, found non-terminal items: {non_terminal}")

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
            key=lambda entry: str(entry.get("created_at") or ""),
        )
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

            request_index = next(
                (
                    index
                    for index, actual in enumerate(event_list)
                    if actual.get("type") == f"stage.gate.{request_action}"
                    and isinstance(actual.get("data"), dict)
                    and actual["data"].get("stage_name") == stage_name
                ),
                None,
            )
            resume_index = next(
                (
                    index
                    for index, actual in enumerate(event_list)
                    if request_index is not None
                    and index > request_index
                    and actual.get("type") == f"stage.gate.{resume_action}"
                    and isinstance(actual.get("data"), dict)
                    and actual["data"].get("stage_name") == stage_name
                ),
                None,
            )

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

            check_name = (
                f"gate_rework_sequences:{stage_name}:{request_action}->{required_event_type}->{resume_action}"
            )
            checks.append({"name": check_name, "passed": matched})
            if not matched:
                failures.append(
                    f"expected {required_event_type!r} for stage {stage_name!r} between "
                    f"stage.gate.{request_action} and stage.gate.{resume_action}"
                )

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
        "metadata": {"live_test": {"scenario_name": scenario_name}},
    }


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
            ),
            expected=(201,),
            label="workflows.create",
        )
    )

    workflow_id = created["id"]
    deadline = time.time() + timeout_seconds
    latest_workflow = created
    latest_approvals: dict[str, Any] | None = None
    poll_iterations = 0
    approved_gate_ids: set[str] = set()
    approval_actions: list[dict[str, Any]] = []
    consumed_decisions: set[int] = set()

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
        if latest_workflow.get("state") in TERMINAL_STATES:
            break
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
        time.sleep(poll_interval_seconds)

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
    events_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/events?limit=500",
        expected=(200,),
        label="workflows.events",
    )
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

    final_state = latest_workflow.get("state")
    verification = evaluate_expectations(
        {} if scenario is None else scenario["expect"],
        workflow=latest_workflow,
        board=board_snapshot,
        work_items=work_items_snapshot,
        workspace=workspace_snapshot,
        artifacts=artifacts_snapshot,
        approval_actions=approval_actions,
        events=events_snapshot,
    )
    print(
        json.dumps(
            {
                "workflow_id": workflow_id,
                "state": final_state,
                "terminal": final_state in TERMINAL_STATES,
                "timed_out": final_state not in TERMINAL_STATES,
                "poll_iterations": poll_iterations,
                "scenario_name": scenario_name,
                "approval_mode": approval_mode,
                "workflow": latest_workflow,
                "board": board_snapshot,
                "work_items": work_items_snapshot,
                "events": events_snapshot,
                "approvals": approvals_snapshot,
                "approval_actions": approval_actions,
                "workspace": workspace_snapshot,
                "artifacts": artifacts_snapshot,
                "verification": verification,
            }
        )
    )
    if not verification["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
