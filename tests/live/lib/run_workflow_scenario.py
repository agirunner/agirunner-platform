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
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from live_test_api import (
    ApiClient,
    TraceRecorder,
    docker_compose_psql_json,
    docker_exec_text,
    docker_inspect_json,
    read_json,
    write_json,
)
from scenario_config import load_scenario
from specialist_capability_proof import (
    build_capability_proof,
    evaluate_capability_expectations,
)
from workflow_scope_trace import build_workspace_scope_trace
from workflow_efficiency import (
    collect_execution_logs,
    evaluate_efficiency_expectations,
    summarize_efficiency,
)

TERMINAL_STATES = {"completed", "failed", "cancelled"}
DEFAULT_FINAL_SETTLE_ATTEMPTS = 60
DEFAULT_FINAL_SETTLE_DELAY_SECONDS = 1
TASK_LIST_PER_PAGE = 100
OUTCOME_DRIVEN_VERIFICATION_MODE = 'outcome_driven'
STRICT_VERIFICATION_MODE = 'strict'
GUIDED_CLOSURE_HELPER_TOOLS = {
    "close_work_item_with_callouts",
    "close_workflow_with_callouts",
    "reattach_or_replace_stale_owner",
    "reopen_work_item_for_missing_handoff",
    "rerun_task_with_corrected_brief",
    "waive_preferred_step",
}
LOCAL_REMOTE_MCP_FIXTURE_HOSTS = {"live-test-remote-mcp-fixture", "127.0.0.1", "localhost"}
REMOTE_MCP_FIXTURE_ADMIN_PATH = "/__admin/invocations"


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def env_int(name: str, default: int) -> int:
    value = env(name, str(default))
    return int(value)


def default_remote_mcp_fixture_admin_url() -> str:
    port = env("LIVE_TEST_REMOTE_MCP_FIXTURE_PORT", "18080")
    return f"http://127.0.0.1:{port}{REMOTE_MCP_FIXTURE_ADMIN_PATH}"


def is_local_remote_mcp_fixture_endpoint(endpoint_url: str) -> bool:
    parsed = urlparse(endpoint_url)
    hostname = (parsed.hostname or "").strip().lower()
    return hostname in LOCAL_REMOTE_MCP_FIXTURE_HOSTS


def local_remote_mcp_fixture_servers(capability_setup: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(capability_setup, dict):
        return []
    servers = capability_setup.get("remote_mcp_servers", [])
    if not isinstance(servers, list):
        return []

    local_servers: list[dict[str, Any]] = []
    for server in servers:
        if not isinstance(server, dict):
            continue
        endpoint_url = str(server.get("endpoint_url") or server.get("endpointUrl") or "").strip()
        if endpoint_url == "" or not is_local_remote_mcp_fixture_endpoint(endpoint_url):
            continue
        local_servers.append(server)
    return local_servers


def capture_remote_mcp_fixture_snapshot() -> dict[str, Any]:
    admin_url = env("LIVE_TEST_REMOTE_MCP_FIXTURE_ADMIN_URL", default_remote_mcp_fixture_admin_url())
    try:
        with urlopen(admin_url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError(f"unexpected fixture snapshot payload: {payload!r}")
        return {"ok": True, "admin_url": admin_url, **payload}
    except (OSError, HTTPError, URLError, json.JSONDecodeError, RuntimeError) as error:
        return {
            "ok": False,
            "admin_url": admin_url,
            "error": str(error),
            "event_count": 0,
            "last_event_id": 0,
            "tool_call_count": 0,
            "tool_names": [],
            "events": [],
        }


def summarize_remote_mcp_fixture_activity(
    *,
    before_snapshot: dict[str, Any] | None,
    after_snapshot: dict[str, Any] | None,
    capability_setup: dict[str, Any] | None,
) -> dict[str, Any]:
    local_servers = local_remote_mcp_fixture_servers(capability_setup)
    endpoint_urls = [
        str(server.get("endpoint_url") or server.get("endpointUrl") or "").strip()
        for server in local_servers
    ]
    endpoint_paths = {
        urlparse(endpoint_url).path
        for endpoint_url in endpoint_urls
        if endpoint_url.strip() != ""
    }
    server_slugs = [
        str(server.get("slug") or "").strip()
        for server in local_servers
        if str(server.get("slug") or "").strip() != ""
    ]
    if not local_servers:
        return {
            "applicable": False,
            "ok": True,
            "server_slugs": [],
            "endpoint_urls": [],
            "endpoint_paths": [],
            "event_count_delta": 0,
            "tool_call_count_delta": 0,
            "tool_names": [],
            "events": [],
        }

    before = before_snapshot if isinstance(before_snapshot, dict) else {}
    after = after_snapshot if isinstance(after_snapshot, dict) else {}
    if before.get("ok") is not True or after.get("ok") is not True:
        return {
            "applicable": True,
            "ok": False,
            "server_slugs": server_slugs,
            "endpoint_urls": endpoint_urls,
            "endpoint_paths": sorted(endpoint_paths),
            "admin_url": after.get("admin_url") or before.get("admin_url"),
            "before_snapshot_ok": bool(before.get("ok")),
            "after_snapshot_ok": bool(after.get("ok")),
            "error": after.get("error") or before.get("error") or "fixture snapshot unavailable",
            "event_count_delta": 0,
            "tool_call_count_delta": 0,
            "tool_names": [],
            "events": [],
        }

    before_last_event_id = int(before.get("last_event_id") or 0)
    after_events = after.get("events", [])
    if not isinstance(after_events, list):
        after_events = []
    events = [
        event
        for event in after_events
        if isinstance(event, dict)
        and int(event.get("event_id") or 0) > before_last_event_id
        and str(event.get("endpoint") or "") in endpoint_paths
    ]
    tool_call_events = [event for event in events if event.get("kind") == "tool_call"]
    tool_names = [
        str(event.get("tool_name") or "").strip()
        for event in tool_call_events
        if str(event.get("tool_name") or "").strip() != ""
    ]
    counts: dict[str, int] = {}
    for event in events:
        kind = str(event.get("kind") or "").strip()
        if kind == "":
            continue
        counts[kind] = counts.get(kind, 0) + 1

    return {
        "applicable": True,
        "ok": True,
        "server_slugs": server_slugs,
        "endpoint_urls": endpoint_urls,
        "endpoint_paths": sorted(endpoint_paths),
        "admin_url": after.get("admin_url"),
        "before_last_event_id": before_last_event_id,
        "after_last_event_id": int(after.get("last_event_id") or 0),
        "event_count_delta": len(events),
        "tool_call_count_delta": len(tool_call_events),
        "counts": dict(sorted(counts.items())),
        "tool_names": tool_names,
        "events": events,
    }


def merge_remote_mcp_fixture_into_capability_proof(
    proof: dict[str, Any],
    fixture_activity: dict[str, Any],
) -> dict[str, Any]:
    merged = dict(proof)
    merged["remote_mcp_fixture"] = fixture_activity
    merged["fixture_tool_call_count"] = int(fixture_activity.get("tool_call_count_delta", 0) or 0)
    merged["fixture_tool_names"] = [
        str(name).strip()
        for name in fixture_activity.get("tool_names", [])
        if isinstance(name, str) and name.strip() != ""
    ]
    return merged


def extract_data(response: Any) -> Any:
    if not isinstance(response, dict) or "data" not in response:
        raise RuntimeError(f"unexpected response payload: {response!r}")
    return response["data"]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def default_compose_file() -> str:
    return str(Path(__file__).resolve().parents[2] / "docker-compose.yml")


def build_db_state_query(workflow_id: str) -> str:
    workflow = sql_literal(workflow_id)
    return f"""
SELECT jsonb_build_object(
  'workflow',
  (
    SELECT to_jsonb(workflow_row)
    FROM (
      SELECT id, state, playbook_id, workspace_id, created_at, updated_at, completed_at
           , live_visibility_mode_override
           , COALESCE(
               live_visibility_mode_override,
               (
                 SELECT live_visibility_mode_default
                 FROM agentic_settings settings
                 WHERE settings.tenant_id = workflows.tenant_id
               ),
               'enhanced'
             ) AS effective_live_visibility_mode
      FROM workflows
      WHERE id = {workflow}
    ) workflow_row
  ),
  'tasks',
  COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(task_row) ORDER BY task_row.created_at)
      FROM (
        SELECT
          id,
          work_item_id,
          role,
          state,
          stage_name,
          is_orchestrator_task,
          execution_backend,
          execution_environment_id,
          execution_environment_snapshot,
          assigned_worker_id,
          created_at,
          updated_at,
          completed_at
        FROM tasks
        WHERE workflow_id = {workflow}
      ) task_row
    ),
    '[]'::jsonb
  ),
  'work_items',
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(work_item_row) ORDER BY work_item_row.created_at)
      FROM (
        SELECT
          id,
          title,
          stage_name,
          column_id,
          rework_count,
          created_at,
          updated_at,
          completed_at
        FROM workflow_work_items
        WHERE workflow_id = {workflow}
      ) work_item_row
    ),
    '[]'::jsonb
  ),
  'operator_briefs',
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(brief_row) ORDER BY COALESCE(brief_row.updated_at, brief_row.created_at) DESC, brief_row.id DESC)
      FROM (
        SELECT
          id,
          work_item_id,
          task_id,
          brief_scope,
          status_kind,
          source_kind,
          source_role_name,
          linked_target_ids,
          related_output_descriptor_ids,
          sequence_number,
          created_at,
          updated_at
        FROM workflow_operator_briefs
        WHERE workflow_id = {workflow}
      ) brief_row
    ),
    '[]'::jsonb
  ),
  'operator_updates',
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(update_row) ORDER BY update_row.created_at DESC, update_row.id DESC)
      FROM (
        SELECT
          id,
          work_item_id,
          task_id,
          update_kind,
          linked_target_ids,
          sequence_number,
          created_at
        FROM workflow_operator_updates
        WHERE workflow_id = {workflow}
      ) update_row
    ),
    '[]'::jsonb
  ),
  'deliverables',
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(deliverable_row) ORDER BY COALESCE(deliverable_row.updated_at, deliverable_row.created_at) DESC)
      FROM (
        SELECT
          id AS descriptor_id,
          work_item_id,
          descriptor_kind,
          delivery_stage,
          state,
          source_brief_id,
          created_at,
          updated_at
        FROM workflow_output_descriptors
        WHERE workflow_id = {workflow}
      ) deliverable_row
    ),
    '[]'::jsonb
  ),
  'completed_handoffs',
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(handoff_row) ORDER BY handoff_row.work_item_id, handoff_row.created_at DESC)
      FROM (
        SELECT DISTINCT ON (th.work_item_id)
          th.id,
          th.work_item_id,
          th.task_id,
          th.role,
          th.created_at
        FROM task_handoffs th
        JOIN workflow_work_items wi
          ON wi.workflow_id = th.workflow_id
         AND wi.id = th.work_item_id
        WHERE th.workflow_id = {workflow}
          AND wi.completed_at IS NOT NULL
        ORDER BY th.work_item_id,
                 CASE WHEN th.role = 'orchestrator' THEN 1 ELSE 0 END,
                 th.sequence DESC,
                 th.created_at DESC
      ) handoff_row
    ),
    '[]'::jsonb
  )
)::text;
""".strip()


def collect_db_state_snapshot(trace: TraceRecorder | None, *, workflow_id: str) -> dict[str, Any]:
    try:
        payload = docker_compose_psql_json(
            compose_file=env("LIVE_TEST_COMPOSE_FILE", default_compose_file(), required=True),
            compose_project_name=env("LIVE_TEST_COMPOSE_PROJECT_NAME", "agirunner-platform", required=True),
            postgres_user=env("POSTGRES_USER", "agirunner", required=True),
            postgres_db=env("POSTGRES_DB", "agirunner", required=True),
            sql=build_db_state_query(workflow_id),
            trace=trace,
        )
        if not isinstance(payload, dict):
            raise RuntimeError(f"unexpected DB payload: {payload!r}")
        return {"ok": True, **payload}
    except Exception as error:
        return {"ok": False, "error": str(error)}


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


def _workflow_final_artifacts(workflow: dict[str, Any]) -> list[str]:
    orchestration_state = workflow.get("orchestration_state")
    if not isinstance(orchestration_state, dict):
        return []
    final_artifacts = orchestration_state.get("final_artifacts")
    if not isinstance(final_artifacts, list):
        return []
    return [
        artifact.strip()
        for artifact in final_artifacts
        if isinstance(artifact, str) and artifact.strip() != ""
    ]


def _completed_task_output_artifact_count(workflow: dict[str, Any]) -> int:
    count = 0
    for task in _workflow_tasks(workflow):
        if not isinstance(task, dict):
            continue
        if bool(task.get('is_orchestrator_task')):
            continue
        if task.get('state') != 'completed':
            continue
        output = task.get('output')
        if not isinstance(output, dict):
            continue
        artifacts = output.get('artifacts')
        if not isinstance(artifacts, list):
            continue
        count += sum(1 for artifact in artifacts if isinstance(artifact, dict) and artifact.get('path'))
    return count


def output_artifact_count(*, workflow: dict[str, Any], snapshot: Any) -> int:
    artifact_count = len(_artifacts(snapshot))
    if artifact_count > 0:
        return artifact_count
    final_artifact_count = len(_workflow_final_artifacts(workflow))
    if final_artifact_count > 0:
        return final_artifact_count
    return _completed_task_output_artifact_count(workflow)


def completed_non_orchestrator_task_count(workflow: dict[str, Any]) -> int:
    return sum(
        1
        for task in _workflow_tasks(workflow)
        if isinstance(task, dict)
        and not bool(task.get('is_orchestrator_task'))
        and task.get('state') == 'completed'
    )


def has_fatal_log_anomalies(evidence: dict[str, Any]) -> bool:
    anomalies = evidence.get('log_anomalies', {})
    if not isinstance(anomalies, dict):
        return True
    rows = anomalies.get('rows', [])
    if not isinstance(rows, list):
        return True
    for row in rows:
        if not isinstance(row, dict):
            continue
        level = str(row.get('level') or '').lower()
        status = str(row.get('status') or '').lower()
        if level == 'fatal':
            return True
        if level != 'error' and status != 'failed':
            continue
        task_id = row.get('task_id')
        if isinstance(task_id, str) and task_id.strip() != '':
            continue
        if level == 'error' or status == 'failed':
            return True
    return False


def evaluate_outcome_driven_basics(
    expectations: dict[str, Any],
    *,
    workflow: dict[str, Any],
    work_items: Any,
    board: Any,
    artifacts: Any,
    evidence: dict[str, Any],
    execution_logs: Any | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    checks: list[dict[str, Any]] = []
    failures: list[str] = []

    outcome_envelope = expectations.get('outcome_envelope', {})
    if not isinstance(outcome_envelope, dict):
        outcome_envelope = {}
    allowed_states = outcome_envelope.get('allowed_states')
    if not isinstance(allowed_states, list) or not allowed_states:
        expected_state = expectations.get('state')
        if isinstance(expected_state, str) and expected_state.strip() != '':
            allowed_states = [expected_state]
        else:
            allowed_states = ['completed']
    actual_state = workflow.get('state')
    state_passed = actual_state in allowed_states
    checks.append(
        {
            'name': 'outcome.workflow_state',
            'passed': state_passed,
            'expected': allowed_states,
            'actual': actual_state,
        }
    )
    if not state_passed:
        failures.append(f"expected workflow state in {allowed_states!r}, got {actual_state!r}")

    output_count = output_artifact_count(workflow=workflow, snapshot=artifacts)
    output_required = bool(outcome_envelope.get('require_output_artifacts', True))
    output_passed = (output_count > 0) if output_required else True
    checks.append(
        {
            'name': 'outcome.output_artifacts',
            'passed': output_passed,
            'required': output_required,
            'actual_count': output_count,
        }
    )
    if output_required and not output_passed:
        failures.append('expected at least one output artifact for outcome-driven verification')

    completed_specialist_tasks = completed_non_orchestrator_task_count(workflow)
    tasks_required = bool(outcome_envelope.get('require_completed_non_orchestrator_tasks', True))
    task_output_passed = (completed_specialist_tasks > 0) if tasks_required else True
    checks.append(
        {
            'name': 'outcome.completed_non_orchestrator_tasks',
            'passed': task_output_passed,
            'required': tasks_required,
            'actual_count': completed_specialist_tasks,
        }
    )
    if tasks_required and not task_output_passed:
        failures.append('expected at least one completed non-orchestrator task for outcome-driven verification')

    items = _work_items(work_items)
    terminal_items = [item for item in items if _work_item_is_terminal(item, board)]
    work_items_required = bool(outcome_envelope.get('require_terminal_work_items', True))
    work_item_passed = (len(terminal_items) > 0) if work_items_required else True
    checks.append(
        {
            'name': 'outcome.terminal_work_items_present',
            'passed': work_item_passed,
            'required': work_items_required,
            'actual_count': len(terminal_items),
        }
    )
    if work_items_required and not work_item_passed:
        failures.append('expected at least one terminal work item for outcome-driven verification')

    db_state = evidence.get('db_state', {})
    db_required = bool(outcome_envelope.get('require_db_state', True))
    db_passed = (isinstance(db_state, dict) and bool(db_state.get('ok'))) if db_required else True
    checks.append({'name': 'outcome.db_state_present', 'passed': db_passed, 'required': db_required})
    if db_required and not db_passed:
        failures.append('expected DB evidence to be present')

    runtime_cleanup = evidence.get('runtime_cleanup', {})
    runtime_required = bool(outcome_envelope.get('require_runtime_cleanup', True))
    runtime_passed = (
        isinstance(runtime_cleanup, dict) and bool(runtime_cleanup.get('all_clean'))
    ) if runtime_required else True
    checks.append({'name': 'outcome.runtime_cleanup', 'passed': runtime_passed, 'required': runtime_required})
    if runtime_required and not runtime_passed:
        failures.append('expected runtime cleanup evidence to show no dangling runtimes')

    log_required = bool(outcome_envelope.get('require_fatal_log_free', True))
    log_passed = (not has_fatal_log_anomalies(evidence)) if log_required else True
    checks.append({'name': 'outcome.fatal_log_anomalies_absent', 'passed': log_passed, 'required': log_required})
    if log_required and not log_passed:
        failures.append('expected logs to be free of fatal anomalies')

    http_status_summary = evidence.get('http_status_summary', {})
    server_error_count = 0
    status_counts: dict[str, int] = {}
    if isinstance(http_status_summary, dict):
        maybe_server_error_count = http_status_summary.get('server_error_count')
        if isinstance(maybe_server_error_count, int):
            server_error_count = maybe_server_error_count
        maybe_status_counts = http_status_summary.get('status_counts')
        if isinstance(maybe_status_counts, dict):
            status_counts = {
                str(key): int(value)
                for key, value in maybe_status_counts.items()
                if isinstance(key, str) and isinstance(value, int)
            }
    http_required = bool(outcome_envelope.get('require_no_http_5xx', True))
    http_passed = server_error_count == 0 if http_required else True
    checks.append(
        {
            'name': 'outcome.http_5xx_absent',
            'passed': http_passed,
            'required': http_required,
            'actual_count': server_error_count,
            'status_counts': status_counts,
        }
    )
    if http_required and not http_passed:
        failures.append('expected persisted execution logs to be free of HTTP 5xx responses')

    execution_environment_usage = evidence.get("execution_environment_usage", {})
    if isinstance(execution_environment_usage, dict) and execution_environment_usage.get("applicable") is True:
        env_passed = bool(execution_environment_usage.get("passed"))
        checks.append(
            {
                "name": "outcome.execution_environment_usage",
                "passed": env_passed,
                "checked_task_count": execution_environment_usage.get("checked_task_count", 0),
                "mismatch_count": execution_environment_usage.get("mismatch_count", 0),
            }
        )
        if not env_passed:
            failures.append("expected task execution environments to match configured expectations")

    evidence_expectations = expectations.get('evidence_expectations', {})
    if isinstance(evidence_expectations, dict) and 'distinct_orchestrator_runtime_count_min' in evidence_expectations:
        minimum = evidence_expectations['distinct_orchestrator_runtime_count_min']
        actual = len(_distinct_orchestrator_runtime_actors(execution_logs))
        passed = isinstance(minimum, int) and actual >= minimum
        checks.append(
            {
                'name': 'outcome.distinct_orchestrator_runtime_count_min',
                'passed': passed,
                'expected_min': minimum,
                'actual': actual,
            }
        )
        if not passed:
            failures.append(f'expected at least {minimum} distinct orchestrator runtime actor(s), found {actual}')

    return checks, failures


def _workflow_events(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _stage_gates(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _workflow_tasks(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = workflow.get("tasks", [])
    return tasks if isinstance(tasks, list) else []


def _task_rows(snapshot: Any) -> list[dict[str, Any]]:
    if not isinstance(snapshot, dict):
        return []
    data = snapshot.get("data", [])
    return data if isinstance(data, list) else []


def _task_page_count(snapshot: Any) -> int:
    if not isinstance(snapshot, dict):
        return 1
    meta = snapshot.get("meta", {})
    if not isinstance(meta, dict):
        return 1
    pages = meta.get("pages")
    return pages if isinstance(pages, int) and pages > 0 else 1


def fetch_workflow_tasks(
    client: ApiClient,
    *,
    workflow_id: str,
    per_page: int = TASK_LIST_PER_PAGE,
) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        snapshot = client.request(
            "GET",
            f"/api/v1/tasks?workflow_id={workflow_id}&page={page}&per_page={per_page}",
            expected=(200,),
            label=f"tasks.list:{page}",
        )
        tasks.extend(_task_rows(snapshot))
        total_pages = _task_page_count(snapshot)
        page += 1
    return tasks


def attach_workflow_tasks(workflow: dict[str, Any], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    if not tasks:
        return workflow
    return {
        **workflow,
        "tasks": tasks,
    }


def _live_container_rows(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def new_container_observations() -> dict[str, Any]:
    return {"rows": [], "_keys": set()}


def observe_live_containers(observations: dict[str, Any], snapshot: Any) -> None:
    rows = observations.get("rows")
    keys = observations.get("_keys")
    if not isinstance(rows, list) or not isinstance(keys, set):
        return
    for row in _live_container_rows(snapshot):
        if not isinstance(row, dict):
            continue
        normalized = dict(row)
        key = json.dumps(normalized, sort_keys=True, default=str)
        if key in keys:
            continue
        keys.add(key)
        normalized["observed_at"] = now_timestamp()
        rows.append(normalized)


def finalize_container_observations(observations: dict[str, Any]) -> dict[str, Any]:
    rows = observations.get("rows")
    if not isinstance(rows, list):
        return {"rows": [], "row_count": 0}
    return {"rows": [row for row in rows if isinstance(row, dict)], "row_count": len(rows)}


def container_observation_rows(observations: Any) -> list[dict[str, Any]]:
    if not isinstance(observations, dict):
        return []
    rows = observations.get("rows", [])
    return rows if isinstance(rows, list) else []


def _runtime_container_rows(snapshot: Any) -> list[dict[str, Any]]:
    return [
        row
        for row in _live_container_rows(snapshot)
        if isinstance(row, dict) and row.get("kind") in {"orchestrator", "runtime"}
    ]


def _relevant_workspace_entries(entries: list[str], *, relevant_task_ids: set[str] | None) -> list[str]:
    if not relevant_task_ids:
        return entries
    relevant_entry_names = {f"task-{task_id}" for task_id in relevant_task_ids}
    return [entry for entry in entries if entry in relevant_entry_names]


def collect_live_container_snapshot(client: ApiClient, *, label: str) -> dict[str, Any]:
    return client.best_effort_request(
        "GET",
        "/api/v1/fleet/live-containers",
        expected=(200,),
        label=label,
    )


def inspect_runtime_cleanup(
    snapshot: Any,
    *,
    trace: TraceRecorder | None = None,
    relevant_task_ids: set[str] | None = None,
) -> dict[str, Any]:
    runtime_rows = _runtime_container_rows(snapshot)
    inspections: list[dict[str, Any]] = []
    all_clean = len(runtime_rows) > 0
    for row in runtime_rows:
        container_id = row.get("container_id")
        if not isinstance(container_id, str) or container_id.strip() == "":
            all_clean = False
            continue
        try:
            output = docker_exec_text(
                container_id.strip(),
                "if [ -d /tmp/workspace ]; then ls -A /tmp/workspace; fi",
                trace=trace,
            )
            entries = [line.strip() for line in output.splitlines() if line.strip()]
            relevant_entries = _relevant_workspace_entries(entries, relevant_task_ids=relevant_task_ids)
            clean = len(relevant_entries) == 0
        except Exception as error:
            entries = []
            relevant_entries = []
            clean = False
            inspections.append(
                {
                    "container_id": container_id.strip(),
                    "kind": row.get("kind"),
                    "execution_backend": row.get("execution_backend"),
                    "clean": False,
                    "error": str(error),
                    "workspace_entries": entries,
                    "relevant_workspace_entries": relevant_entries,
                }
            )
            all_clean = False
            continue
        inspections.append(
            {
                "container_id": container_id.strip(),
                "kind": row.get("kind"),
                "execution_backend": row.get("execution_backend"),
                "clean": clean,
                "workspace_entries": entries,
                "relevant_workspace_entries": relevant_entries,
            }
        )
        all_clean = all_clean and clean
    return {"all_clean": all_clean, "runtime_containers": inspections}


def inspect_docker_log_rotation(snapshot: Any, *, trace: TraceRecorder | None = None) -> dict[str, Any]:
    runtime_rows = _runtime_container_rows(snapshot)
    inspections: list[dict[str, Any]] = []
    all_bounded = len(runtime_rows) > 0
    for row in runtime_rows:
        container_id = row.get("container_id")
        if not isinstance(container_id, str) or container_id.strip() == "":
            all_bounded = False
            continue
        try:
            inspect_payload = docker_inspect_json(container_id.strip(), trace=trace)
            host_config = inspect_payload.get("HostConfig", {})
            log_config = host_config.get("LogConfig", {}) if isinstance(host_config, dict) else {}
            config = log_config.get("Config", {}) if isinstance(log_config, dict) else {}
            driver = str(log_config.get("Type") or "").strip() if isinstance(log_config, dict) else ""
            bounded = (
                driver != ""
                and isinstance(config, dict)
                and str(config.get("max-size") or "").strip() != ""
                and str(config.get("max-file") or "").strip() != ""
            )
            inspections.append(
                {
                    "container_id": container_id.strip(),
                    "kind": row.get("kind"),
                    "execution_backend": row.get("execution_backend"),
                    "driver": driver,
                    "config": config if isinstance(config, dict) else {},
                    "bounded": bounded,
                }
            )
            all_bounded = all_bounded and bounded
        except Exception as error:
            inspections.append(
                {
                    "container_id": container_id.strip(),
                    "kind": row.get("kind"),
                    "execution_backend": row.get("execution_backend"),
                    "bounded": False,
                    "error": str(error),
                }
            )
            all_bounded = False
    return {"all_runtime_containers_bounded": all_bounded, "runtime_containers": inspections}


def settle_final_live_container_evidence(
    client: ApiClient,
    *,
    max_attempts: int,
    delay_seconds: int,
    trace: TraceRecorder | None,
    live_container_observations: dict[str, Any] | None = None,
    relevant_task_ids: set[str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    latest_live_containers: dict[str, Any] = {"ok": False, "error": "live container snapshot not collected"}
    runtime_cleanup: dict[str, Any] = {"all_clean": False, "error": "runtime cleanup not inspected"}
    docker_log_rotation: dict[str, Any] = {
        "all_runtime_containers_bounded": False,
        "error": "docker log rotation not inspected",
    }

    attempts = max(1, max_attempts)
    for attempt in range(attempts):
        latest_live_containers = collect_live_container_snapshot(client, label="containers.list.final")
        if latest_live_containers.get("ok"):
            if live_container_observations is not None:
                observe_live_containers(live_container_observations, latest_live_containers.get("data"))
            runtime_cleanup = inspect_runtime_cleanup(
                latest_live_containers.get("data"),
                trace=trace,
                relevant_task_ids=relevant_task_ids,
            )
            docker_log_rotation = inspect_docker_log_rotation(latest_live_containers.get("data"), trace=trace)
            if bool(runtime_cleanup.get("all_clean")):
                return latest_live_containers, runtime_cleanup, docker_log_rotation
        else:
            runtime_cleanup = {"all_clean": False, "error": latest_live_containers.get("error")}
            docker_log_rotation = {
                "all_runtime_containers_bounded": False,
                "error": latest_live_containers.get("error"),
            }
        if attempt + 1 < attempts:
            time.sleep(delay_seconds)

    return latest_live_containers, runtime_cleanup, docker_log_rotation


def summarize_log_anomalies(logs: Any) -> dict[str, Any]:
    rows = [
        row
        for row in execution_log_rows(logs)
        if isinstance(row, dict)
        and (
            str(row.get("level") or "").lower() in {"warn", "warning", "error"}
            or str(row.get("status") or "").lower() == "failed"
        )
    ]
    return {"count": len(rows), "rows": rows}


HTTP_STATUS_PATTERN = re.compile(r"\bstatus (?P<status>\d{3})\b")


def _http_status_messages_from_row(row: dict[str, Any]) -> list[str]:
    messages: list[str] = []

    def append_message(value: Any) -> None:
        if isinstance(value, str) and value.strip() != "":
            messages.append(value)

    append_message(row.get("message"))
    error = row.get("error")
    if isinstance(error, dict):
        append_message(error.get("message"))
    else:
        append_message(error)
    payload = row.get("payload")
    if isinstance(payload, dict):
        append_message(payload.get("message"))
        append_message(payload.get("error"))
        output = payload.get("output")
        if isinstance(output, dict):
            append_message(output.get("message"))
            append_message(output.get("error"))
        else:
            append_message(output)
    return messages


def summarize_http_status_anomalies(logs: Any) -> dict[str, Any]:
    status_counts: dict[str, int] = {}
    rows: list[dict[str, Any]] = []
    client_error_count = 0
    server_error_count = 0
    for row in execution_log_rows(logs):
        if not isinstance(row, dict):
            continue
        matched_statuses = {
            match.group("status")
            for message in _http_status_messages_from_row(row)
            for match in [HTTP_STATUS_PATTERN.search(message)]
            if match is not None
        }
        if not matched_statuses:
            continue
        for status in matched_statuses:
            status_counts[status] = status_counts.get(status, 0) + 1
            status_code = int(status)
            if 400 <= status_code <= 499:
                client_error_count += 1
            elif 500 <= status_code <= 599:
                server_error_count += 1
        rows.append(
            {
                "id": row.get("id"),
                "task_id": row.get("task_id"),
                "operation": row.get("operation"),
                "level": row.get("level"),
                "status": row.get("status"),
                "http_statuses": sorted(matched_statuses),
            }
        )
    return {
        "count": len(rows),
        "status_counts": status_counts,
        "client_error_count": client_error_count,
        "server_error_count": server_error_count,
        "rows": rows,
    }


def _completion_callouts(source: Any) -> dict[str, Any]:
    if not isinstance(source, dict):
        return {}
    callouts = source.get("completion_callouts")
    return callouts if isinstance(callouts, dict) else {}


def _count_completion_notes(callouts: dict[str, Any]) -> int:
    notes = callouts.get("completion_notes")
    if isinstance(notes, str):
        return 1 if notes.strip() != "" else 0
    if isinstance(notes, list):
        return sum(1 for note in notes if isinstance(note, str) and note.strip() != "")
    return 0


def _count_list_entries(value: Any) -> int:
    if not isinstance(value, list):
        return 0
    return len(value)


def _count_work_item_completion_callout_entries(work_items: Any, key: str) -> int:
    total = 0
    for item in _work_items(work_items):
        total += _count_list_entries(_completion_callouts(item).get(key))
    return total


def _tool_name_from_row(row: dict[str, Any]) -> str:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return ""
    tool = payload.get("tool")
    return str(tool).strip() if isinstance(tool, str) else ""


def _tool_result_output(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return {}
    output = payload.get("output")
    if isinstance(output, dict):
        return output
    if not isinstance(output, str) or output.strip() == "":
        return {}
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _count_anomaly_levels(rows: list[dict[str, Any]]) -> tuple[int, int]:
    warning_count = 0
    error_count = 0
    for row in rows:
        level = str(row.get("level") or "").lower()
        if level in {"warn", "warning"}:
            warning_count += 1
            continue
        if level in {"error", "fatal"} or str(row.get("status") or "").lower() == "failed":
            error_count += 1
    return warning_count, error_count


def _execution_row_actor_handle(row: dict[str, Any]) -> str:
    actor_name = str(row.get("actor_name") or "").strip()
    if actor_name and actor_name.lower() not in {"worker", "agent", "runtime"}:
        return actor_name
    actor_id = str(row.get("actor_id") or "").strip()
    if actor_id and actor_id.lower() not in {"worker", "agent", "runtime"}:
        return actor_id
    return ""


def _distinct_orchestrator_runtime_actors(execution_logs: Any) -> list[str]:
    actors: set[str] = set()
    for row in execution_log_rows(execution_logs):
        role = str(row.get("role") or "").strip()
        if role != "orchestrator":
            continue
        operation = str(row.get("operation") or "").strip()
        if operation not in {"task.execute", "tool.execute", "runtime.task.start"}:
            continue
        actor = _execution_row_actor_handle(row)
        if actor:
            actors.add(actor)
    return sorted(actors)


def _count_container_kinds(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        kind = row.get("kind")
        if not isinstance(kind, str) or kind.strip() == "":
            continue
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def _task_metric_int(task: dict[str, Any], key: str) -> int:
    metrics = task.get("metrics")
    if not isinstance(metrics, dict):
        return 0
    value = metrics.get(key)
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def build_scenario_outcome_metrics(
    *,
    final_state: str,
    verification: dict[str, Any],
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    stage_gates: Any,
    artifacts: Any,
    approval_actions: list[dict[str, Any]],
    workflow_actions: list[dict[str, Any]],
    execution_logs: Any,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    verification_payload = verification if isinstance(verification, dict) else {}
    workflow_callouts = _completion_callouts(workflow)
    unresolved_advisory_item_count = _count_list_entries(
        workflow_callouts.get("unresolved_advisory_items")
    ) + _count_work_item_completion_callout_entries(work_items, "unresolved_advisory_items")
    helper_tool_counts: dict[str, int] = {}
    recoverable_mutation_count = 0
    recovery_class_counts: dict[str, int] = {}
    suggested_next_action_count = 0

    for row in execution_log_rows(execution_logs):
        operation = str(row.get("operation") or "").strip()
        if operation == "tool_call":
            tool_name = _tool_name_from_row(row)
            if tool_name in GUIDED_CLOSURE_HELPER_TOOLS:
                helper_tool_counts[tool_name] = helper_tool_counts.get(tool_name, 0) + 1
            continue
        if operation != "tool_result":
            continue
        output = _tool_result_output(row)
        if output.get("mutation_outcome") != "recoverable_not_applied":
            continue
        recoverable_mutation_count += 1
        recovery_class = output.get("recovery_class")
        if isinstance(recovery_class, str) and recovery_class.strip() != "":
            recovery_class_counts[recovery_class] = recovery_class_counts.get(recovery_class, 0) + 1
        suggested_next_actions = output.get("suggested_next_actions")
        if isinstance(suggested_next_actions, list):
            suggested_next_action_count += len(suggested_next_actions)

    gate_effect_counts: dict[str, int] = {}
    for gate in _stage_gates(stage_gates):
        if not isinstance(gate, dict):
            continue
        closure_effect = gate.get("closure_effect")
        if not isinstance(closure_effect, str) or closure_effect.strip() == "":
            continue
        gate_effect_counts[closure_effect] = gate_effect_counts.get(closure_effect, 0) + 1

    anomalies = evidence.get("log_anomalies", {})
    anomaly_rows = anomalies.get("rows", []) if isinstance(anomalies, dict) else []
    if not isinstance(anomaly_rows, list):
        anomaly_rows = []
    warning_count, error_count = _count_anomaly_levels(
        [row for row in anomaly_rows if isinstance(row, dict)]
    )
    http_status_summary = evidence.get("http_status_summary", {})
    http_status_counts: dict[str, int] = {}
    http_client_error_count = 0
    http_server_error_count = 0
    if isinstance(http_status_summary, dict):
        maybe_status_counts = http_status_summary.get("status_counts")
        if isinstance(maybe_status_counts, dict):
            http_status_counts = {
                str(key): int(value)
                for key, value in maybe_status_counts.items()
                if isinstance(key, str) and isinstance(value, int)
            }
        maybe_client_error_count = http_status_summary.get("client_error_count")
        if isinstance(maybe_client_error_count, int):
            http_client_error_count = maybe_client_error_count
        maybe_server_error_count = http_status_summary.get("server_error_count")
        if isinstance(maybe_server_error_count, int):
            http_server_error_count = maybe_server_error_count

    runtime_cleanup = evidence.get("runtime_cleanup", {})
    runtime_cleanup_passed = isinstance(runtime_cleanup, dict) and bool(runtime_cleanup.get("all_clean"))
    runtime_cleanup_rows = runtime_cleanup.get("runtime_containers", []) if isinstance(runtime_cleanup, dict) else []
    if not isinstance(runtime_cleanup_rows, list):
        runtime_cleanup_rows = []
    live_containers = evidence.get("live_containers", {})
    live_container_rows = _live_container_rows(live_containers)
    container_observations = evidence.get("container_observations", {})
    observed_container_rows = container_observation_rows(container_observations)
    execution_environment_usage = evidence.get("execution_environment_usage", {})
    if not isinstance(execution_environment_usage, dict):
        execution_environment_usage = {}
    workflow_tasks = _workflow_tasks(workflow)
    orchestrator_runtime_actors = _distinct_orchestrator_runtime_actors(execution_logs)
    orchestrator_tasks = [
        task
        for task in workflow_tasks
        if isinstance(task, dict) and bool(task.get("is_orchestrator_task"))
    ]
    specialist_tasks = [
        task
        for task in workflow_tasks
        if isinstance(task, dict) and not bool(task.get("is_orchestrator_task"))
    ]

    return {
        "status": "passed" if bool(verification_payload.get("passed")) else "failed",
        "workflow_state": final_state,
        "success": {
            "output_artifact_count": output_artifact_count(workflow=workflow, snapshot=artifacts),
            "completed_non_orchestrator_task_count": completed_non_orchestrator_task_count(workflow),
            "terminal_work_item_count": _completed_work_item_count(work_items, board),
            "approval_action_count": len(approval_actions),
            "workflow_action_count": len(workflow_actions),
        },
        "closure": {
            "completion_note_count": _count_completion_notes(workflow_callouts),
            "residual_risk_count": _count_list_entries(workflow_callouts.get("residual_risks")),
            "waived_step_count": _count_list_entries(workflow_callouts.get("waived_steps")),
            "unresolved_advisory_item_count": unresolved_advisory_item_count,
        },
        "invoked_controls": {
            "closure_effect_counts": gate_effect_counts,
        },
        "orchestrator_improvisation": {
            "helper_tool_usage_count": sum(helper_tool_counts.values()),
            "helper_tool_counts": helper_tool_counts,
            "recoverable_mutation_count": recoverable_mutation_count,
            "recovery_class_counts": recovery_class_counts,
            "suggested_next_action_count": suggested_next_action_count,
        },
        "verification": {
            "advisory_count": len(verification_payload.get("advisories", []))
            if isinstance(verification_payload.get("advisories"), list)
            else 0,
            "failure_count": len(verification_payload.get("failures", []))
            if isinstance(verification_payload.get("failures"), list)
            else 0,
        },
        "agentic_effort": {
            "total_loop_count": sum(_task_metric_int(task, "iterations") for task in workflow_tasks if isinstance(task, dict)),
            "orchestrator_loop_count": sum(_task_metric_int(task, "iterations") for task in orchestrator_tasks),
            "specialist_loop_count": sum(_task_metric_int(task, "iterations") for task in specialist_tasks),
            "input_token_count": sum(_task_metric_int(task, "input_tokens") for task in workflow_tasks if isinstance(task, dict)),
            "output_token_count": sum(_task_metric_int(task, "output_tokens") for task in workflow_tasks if isinstance(task, dict)),
            "total_token_count": sum(_task_metric_int(task, "total_tokens") for task in workflow_tasks if isinstance(task, dict)),
        },
        "orchestrator_distribution": {
            "distinct_runtime_count": len(orchestrator_runtime_actors),
            "runtime_actors": orchestrator_runtime_actors,
        },
        "anomalies": {
            "warning_count": warning_count,
            "error_count": error_count,
            "http_status_counts": http_status_counts,
            "http_client_error_count": http_client_error_count,
            "http_server_error_count": http_server_error_count,
        },
        "hygiene": {
            "runtime_cleanup_passed": runtime_cleanup_passed,
            "runtime_container_count": len([row for row in runtime_cleanup_rows if isinstance(row, dict)]),
            "live_container_kind_counts": _count_container_kinds(
                [row for row in live_container_rows if isinstance(row, dict)]
            ),
            "observed_container_kind_counts": _count_container_kinds(
                [row for row in observed_container_rows if isinstance(row, dict)]
            ),
        },
        "execution_environment_usage": {
            "applicable": bool(execution_environment_usage.get("applicable")),
            "passed": bool(execution_environment_usage.get("passed")),
            "checked_task_count": int(execution_environment_usage.get("checked_task_count", 0) or 0),
            "mismatch_count": int(execution_environment_usage.get("mismatch_count", 0) or 0),
            "observed_environment_ids": execution_environment_usage.get("observed_environment_ids", []),
            "selected_default_environment_id": execution_environment_usage.get("selected_default_environment_id"),
            "tenant_default_environment_id": execution_environment_usage.get("tenant_default_environment_id"),
        },
    }


def write_evidence_artifacts(trace_dir: str, evidence: dict[str, Any]) -> dict[str, str]:
    evidence_root = Path(trace_dir).resolve().parent / "evidence"
    evidence_root.mkdir(parents=True, exist_ok=True)
    file_names = {
        "db_state": "db-state.json",
        "execution_environment_usage": "execution-environment-usage.json",
        "capability_proof": "capability-proof.json",
        "remote_mcp_fixture": "remote-mcp-fixture.json",
        "log_anomalies": "log-anomalies.json",
        "http_status_summary": "http-status-summary.json",
        "live_containers": "live-containers.json",
        "container_observations": "container-observations.json",
        "runtime_cleanup": "runtime-cleanup.json",
        "docker_log_rotation": "docker-log-rotation.json",
        "scenario_outcome_metrics": "scenario-outcome-metrics.json",
        "workspace_scope_trace": "workspace-scope-trace.json",
    }
    written: dict[str, str] = {}
    for key, file_name in file_names.items():
        if key not in evidence:
            continue
        target = evidence_root / file_name
        write_json(target, evidence[key])
        written[key] = str(target)
    return written


def _execution_log_rows(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _completed_work_item_count(work_items_snapshot: Any, board_snapshot: Any) -> int:
    return sum(1 for item in _work_items(work_items_snapshot) if _work_item_is_terminal(item, board_snapshot))


def _open_work_item_count(work_items_snapshot: Any, board_snapshot: Any) -> int:
    return sum(1 for item in _work_items(work_items_snapshot) if not _work_item_is_terminal(item, board_snapshot))


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


def _workflow_task_ids(workflow: dict[str, Any]) -> set[str]:
    return {
        str(task.get("id")).strip()
        for task in _workflow_tasks(workflow)
        if isinstance(task, dict) and isinstance(task.get("id"), str) and str(task.get("id")).strip() != ""
    }


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


def _fleet_pool_requires_current_snapshot(expectations: dict[str, Any]) -> bool:
    return any(field in expectations for field in ("max_runtimes", "active_workflows"))


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


def _event_role(data: dict[str, Any]) -> Any:
    role = data.get("role")
    if role is not None:
        return role
    return data.get("task_role")


def _approval_action_timestamp(
    approval_actions: list[dict[str, Any]],
    *,
    stage_name: str,
    action: str,
    after: datetime | None = None,
) -> datetime | None:
    for item in approval_actions:
        if not isinstance(item, dict):
            continue
        if item.get("stage_name") != stage_name:
            continue
        if item.get("action") != action:
            continue
        submitted_at = _parse_timestamp(item.get("submitted_at"))
        if submitted_at is None:
            continue
        if after is not None and submitted_at <= after:
            continue
        return submitted_at
    return None


def _matches_rework_sequence(
    *,
    event_list: list[dict[str, Any]],
    workflow_tasks: list[dict[str, Any]],
    stage_name: str,
    request_event_type: str,
    resume_event_type: str,
    required_event_type: str,
    required_role: Any,
    require_non_orchestrator: bool,
) -> bool:
    request_event = next(
        (
            actual
            for actual in event_list
            if actual.get("type") == request_event_type
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
            and actual.get("type") == resume_event_type
            and isinstance(actual.get("data"), dict)
            and actual["data"].get("stage_name") == stage_name
        ),
        None,
    )
    resume_index = event_list.index(resume_event) if resume_event in event_list else None

    if request_index is not None and resume_index is not None:
        for actual in event_list[request_index + 1 : resume_index]:
            data = actual.get("data")
            if not isinstance(data, dict):
                continue
            if actual.get("type") != required_event_type or data.get("stage_name") != stage_name:
                continue
            role = _event_role(data)
            if require_non_orchestrator and role == "orchestrator":
                continue
            if required_role is not None and role != required_role:
                continue
            return True

    if request_event is None or resume_event is None:
        return False
    request_at = _parse_timestamp(request_event.get("created_at"))
    resume_at = _parse_timestamp(resume_event.get("created_at"))
    if request_at is None or resume_at is None:
        return False

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
            return True
    return False


def _matches_continuity_rework_sequence(
    *,
    work_items_snapshot: Any,
    execution_logs: Any,
    workflow_tasks: list[dict[str, Any]],
    stage_name: str,
    required_role: str,
    minimum_rework_count: int,
    assessment_stage_name: str,
    assessment_task_min_count: int,
) -> bool:
    work_items_list = _work_items(work_items_snapshot)
    log_rows = sorted(
        _execution_log_rows(execution_logs),
        key=lambda row: _parse_timestamp(row.get("created_at"))
        or datetime.min.replace(tzinfo=timezone.utc),
    )
    candidate_work_items = [
        item
        for item in work_items_list
        if isinstance(item, dict)
        and item.get("stage_name") == stage_name
        and int(item.get("rework_count") or 0) >= minimum_rework_count
    ]
    if not candidate_work_items:
        return False

    for stage_item in candidate_work_items:
        work_item_id = stage_item.get("id")
        if not isinstance(work_item_id, str) or work_item_id.strip() == "":
            continue

        rejection_at = next(
            (
                _parse_timestamp(row.get("created_at"))
                for row in log_rows
                if row.get("operation") == "work_item.continuity.assessment_requested_changes"
                and row.get("work_item_id") == work_item_id
            ),
            None,
        )
        if rejection_at is None:
            continue

        assessment_children = [
            item
            for item in work_items_list
            if isinstance(item, dict)
            and item.get("parent_work_item_id") == work_item_id
            and item.get("stage_name") == assessment_stage_name
            and int(item.get("task_count") or 0) >= assessment_task_min_count
        ]
        same_work_item_assessments = [
            task
            for task in workflow_tasks
            if isinstance(task, dict)
            and task.get("work_item_id") == work_item_id
            and task.get("stage_name") == assessment_stage_name
            and _task_kind(task) == "assessment"
        ]
        if not assessment_children and len(same_work_item_assessments) < assessment_task_min_count:
            continue

        reworked_task_completed = any(
            isinstance(task, dict)
            and task.get("stage_name") == stage_name
            and task.get("role") == required_role
            and (_parse_timestamp(task.get("completed_at")) or datetime.min.replace(tzinfo=timezone.utc))
            > rejection_at
            for task in workflow_tasks
        )
        if reworked_task_completed:
            return True

    return False


def _task_mapping(task: dict[str, Any], field_name: str) -> dict[str, Any]:
    value = task.get(field_name)
    return value if isinstance(value, dict) else {}


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or value.strip() == "":
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _task_kind(task: dict[str, Any]) -> str:
    direct_kind = task.get("task_kind")
    if isinstance(direct_kind, str) and direct_kind.strip() != "":
        return direct_kind.strip()
    direct_type = task.get("task_type")
    if isinstance(direct_type, str) and direct_type.strip() in {"assessment", "approval"}:
        return direct_type.strip()
    metadata = _task_mapping(task, "metadata")
    metadata_kind = metadata.get("task_kind")
    if isinstance(metadata_kind, str) and metadata_kind.strip() != "":
        return metadata_kind.strip()
    metadata_type = metadata.get("task_type")
    if isinstance(metadata_type, str) and metadata_type.strip() in {"assessment", "approval"}:
        return metadata_type.strip()
    if task.get("is_orchestrator_task"):
        return "orchestrator"
    return "delivery"


def _task_subject_task_id(task: dict[str, Any]) -> str | None:
    for source in (_task_mapping(task, "input"), _task_mapping(task, "metadata")):
        value = source.get("subject_task_id")
        if isinstance(value, str) and value.strip() != "":
            return value.strip()
    return None


def _task_subject_revision(task: dict[str, Any]) -> int | None:
    for source in (_task_mapping(task, "input"), _task_mapping(task, "metadata")):
        value = source.get("subject_revision")
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str) and value.isdigit():
            parsed = int(value)
            if parsed > 0:
                return parsed
    return None


def _task_resolution(task: dict[str, Any]) -> str | None:
    candidates = (
        task.get("resolution"),
        _task_mapping(task, "output").get("resolution"),
        _task_mapping(task, "handoff").get("resolution"),
        task.get("latest_handoff_resolution"),
        _latest_submitted_handoff(task).get("resolution"),
    )
    for value in candidates:
        if isinstance(value, str) and value.strip() != "":
            return value.strip()
    return None


def _latest_submitted_handoff(task: dict[str, Any]) -> dict[str, Any]:
    output = _task_mapping(task, "output")
    raw = output.get("raw")
    if not isinstance(raw, dict):
        return {}
    loop = raw.get("loop")
    if not isinstance(loop, dict):
        return {}
    iterations = loop.get("iterations")
    if not isinstance(iterations, list):
        return {}
    for iteration in reversed(iterations):
        if not isinstance(iteration, dict):
            continue
        actions = iteration.get("act")
        if not isinstance(actions, list):
            continue
        for action in reversed(actions):
            if not isinstance(action, dict):
                continue
            step = action.get("step")
            if not isinstance(step, dict) or step.get("tool") != "submit_handoff":
                continue
            payload = _json_object(action.get("output"))
            if payload:
                return payload
    return {}


def _task_timestamp(task: dict[str, Any]) -> datetime | None:
    return (
        _parse_timestamp(task.get("completed_at"))
        or _parse_timestamp(task.get("started_at"))
        or _parse_timestamp(task.get("created_at"))
    )


def _matching_subject_task_ids(
    workflow_tasks: list[dict[str, Any]],
    *,
    subject_task_id: Any,
    subject_role: Any,
) -> set[str]:
    if isinstance(subject_task_id, str) and subject_task_id.strip() != "":
        return {subject_task_id.strip()}
    if not isinstance(subject_role, str) or subject_role.strip() == "":
        return set()
    role_name = subject_role.strip()
    matching_ids: set[str] = set()
    for task in workflow_tasks:
        if not isinstance(task, dict):
            continue
        if task.get("role") != role_name:
            continue
        if _task_kind(task) == "assessment":
            continue
        task_id = task.get("id")
        if isinstance(task_id, str) and task_id.strip() != "":
            matching_ids.add(task_id.strip())
    return matching_ids


def _expected_sequence(entry: dict[str, Any], *, singular_key: str, plural_key: str) -> list[str]:
    if plural_key in entry:
        value = entry.get(plural_key)
        if not isinstance(value, list):
            return []
        return [
            item.strip()
            for item in value
            if isinstance(item, str) and item.strip() != ""
        ]
    value = entry.get(singular_key)
    if isinstance(value, str) and value.strip() != "":
        return [value.strip()]
    fallback = entry.get("expected_actions")
    if isinstance(fallback, list):
        return [
            item.strip()
            for item in fallback
            if isinstance(item, str) and item.strip() != ""
        ]
    return []


def _match_entry(task: dict[str, Any], *, role: Any, stage_name: Any) -> bool:
    if isinstance(role, str) and role.strip() != "" and task.get("role") != role.strip():
        return False
    if (
        isinstance(stage_name, str)
        and stage_name.strip() != ""
        and task.get("stage_name") != stage_name.strip()
    ):
        return False
    return True


def _matches_field_expectations(entry: dict[str, Any], expectations: dict[str, Any]) -> bool:
    return all(entry.get(field_name) == expected_value for field_name, expected_value in expectations.items())


def _get_dotted_value(source: Any, dotted_path: str) -> Any:
    if not isinstance(dotted_path, str) or dotted_path.strip() == "":
        return None
    current = source
    for segment in dotted_path.split("."):
        key = segment.strip()
        if key == "":
            return None
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _find_matching_entries(
    entries: list[dict[str, Any]],
    match: dict[str, Any],
) -> list[dict[str, Any]]:
    return [
        entry
        for entry in entries
        if isinstance(entry, dict) and _matches_field_expectations(entry, match)
    ]


def _matches_nested_expectations(entry: dict[str, Any], expectations: dict[str, Any]) -> bool:
    for field_name, expected_value in expectations.items():
        if field_name == "payload" and isinstance(expected_value, dict):
            payload = entry.get("payload")
            if not isinstance(payload, dict) or not _matches_nested_expectations(payload, expected_value):
                return False
            continue
        if entry.get(field_name) != expected_value:
            return False
    return True


def _evaluate_task_backend_expectation(
    entry: dict[str, Any],
    *,
    workflow_tasks: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    match = entry.get("match", {})
    if not isinstance(match, dict):
        match = {}
    minimum_count = int(entry.get("min_count", 1))
    expected_backend = entry.get("execution_backend")
    expected_sandbox = entry.get("used_task_sandbox")
    matches = [
        task
        for task in workflow_tasks
        if isinstance(task, dict)
        and _matches_field_expectations(task, match)
        and task.get("execution_backend") == expected_backend
        and task.get("used_task_sandbox") == expected_sandbox
    ]
    passed = len(matches) >= minimum_count
    check = {
        "name": f"task_backend_expectations:{match}",
        "passed": passed,
        "expected_min_count": minimum_count,
        "actual_count": len(matches),
    }
    if passed:
        return check, None
    return (
        check,
        f"expected at least {minimum_count} task(s) matching {match} with "
        f"execution_backend={expected_backend!r} and used_task_sandbox={expected_sandbox!r}, found {len(matches)}",
    )


def _evaluate_log_row_expectation(
    entry: dict[str, Any],
    *,
    log_rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    match = entry.get("match", {})
    if not isinstance(match, dict):
        match = {}
    minimum_count = int(entry.get("min_count", 1))
    matches = [row for row in log_rows if isinstance(row, dict) and _matches_nested_expectations(row, match)]
    passed = len(matches) >= minimum_count
    check = {
        "name": f"log_row_expectations:{match}",
        "passed": passed,
        "expected_min_count": minimum_count,
        "actual_count": len(matches),
    }
    if passed:
        return check, None
    return check, f"expected at least {minimum_count} execution log row(s) matching {match}, found {len(matches)}"


def _evaluate_structured_breakout_expectation(
    entry: dict[str, Any],
    *,
    workflow_tasks: list[dict[str, Any]],
    work_items_snapshot: Any,
) -> tuple[dict[str, Any], str | None]:
    source_task_match = entry.get("source_task_match", {})
    if not isinstance(source_task_match, dict):
        source_task_match = {}
    source_structured_list_path = str(entry.get("source_structured_list_path") or "").strip()
    item_title_field = str(entry.get("item_title_field") or "title").strip()
    target_stage_name = str(entry.get("target_stage_name") or "").strip()
    target_work_item_title_field = str(entry.get("target_work_item_title_field") or "title").strip()
    target_task_match = entry.get("target_task_match", {})
    if not isinstance(target_task_match, dict):
        target_task_match = {}
    minimum_count = int(entry.get("min_count", 1))

    source_tasks = [
        task
        for task in workflow_tasks
        if isinstance(task, dict) and _matches_field_expectations(task, source_task_match)
    ]

    split_items: list[dict[str, Any]] = []
    for task in source_tasks:
        value = _get_dotted_value(task, source_structured_list_path)
        if isinstance(value, list):
            split_items = [item for item in value if isinstance(item, dict)]
        if split_items:
            break

    expected_titles = [
        str(item.get(item_title_field) or "").strip()
        for item in split_items
        if str(item.get(item_title_field) or "").strip() != ""
    ][: max(0, minimum_count)]

    work_items = [item for item in _work_items(work_items_snapshot) if isinstance(item, dict)]
    missing_titles: list[str] = []
    matched_titles: list[str] = []

    for expected_title in expected_titles:
        matching_work_items = [
            item
            for item in work_items
            if item.get(target_work_item_title_field) == expected_title
            and (target_stage_name == "" or item.get("stage_name") == target_stage_name)
        ]
        if not matching_work_items:
            missing_titles.append(expected_title)
            continue
        has_matching_task = any(
            isinstance(task, dict)
            and any(task.get("work_item_id") == item.get("id") for item in matching_work_items)
            and _matches_field_expectations(task, target_task_match)
            for task in workflow_tasks
        )
        if not has_matching_task:
            missing_titles.append(expected_title)
            continue
        matched_titles.append(expected_title)

    passed = (
        len(source_tasks) > 0
        and len(split_items) >= minimum_count
        and len(matched_titles) >= minimum_count
        and len(missing_titles) == 0
    )
    check = {
        "name": f"structured_breakout_expectations:{source_task_match}",
        "passed": passed,
        "expected_min_count": minimum_count,
        "actual_source_task_count": len(source_tasks),
        "actual_split_count": len(split_items),
        "matched_titles": matched_titles,
        "missing_titles": missing_titles,
    }
    if passed:
        return check, None
    return (
        check,
        f"expected structured breakout from source task match {source_task_match!r} "
        f"to create aligned downstream work for at least {minimum_count} split item(s); "
        f"missing titles: {missing_titles}",
    )


def _evaluate_container_observation_expectation(
    entry: dict[str, Any],
    *,
    observed_rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    match = entry.get("match", {})
    if not isinstance(match, dict):
        match = {}
    minimum_count = int(entry.get("min_count", 1))
    matches = [row for row in observed_rows if isinstance(row, dict) and _matches_nested_expectations(row, match)]
    passed = len(matches) >= minimum_count
    check = {
        "name": f"container_observation_expectations:{match}",
        "passed": passed,
        "expected_min_count": minimum_count,
        "actual_count": len(matches),
    }
    if passed:
        return check, None
    return (
        check,
        f"expected at least {minimum_count} observed live container row(s) matching {match}, found {len(matches)}",
    )


def _evaluate_direct_handoff_expectation(
    entry: dict[str, Any],
    *,
    workflow_tasks: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    source_role = entry.get("source_role")
    source_task_id = entry.get("source_task_id")
    source_stage_name = entry.get("source_stage_name")
    successor_role = entry.get("successor_role")
    successor_stage_name = entry.get("successor_stage_name")
    minimum_count = int(entry.get("minimum_count", 1))
    forbidden_task_kinds = sorted(
        {
            item.strip()
            for item in entry.get("forbid_task_kinds", [])
            if isinstance(item, str) and item.strip() != ""
        }
    )
    source_label = (
        source_task_id.strip()
        if isinstance(source_task_id, str) and source_task_id.strip() != ""
        else str(source_role or "<unknown>").strip()
    )
    successor_label = str(successor_role or "<unknown>").strip()
    check = {
        "name": f"direct_handoff_expectations:{source_label}->{successor_label}",
        "passed": False,
    }

    source_tasks = [
        task
        for task in workflow_tasks
        if isinstance(task, dict)
        and _task_kind(task) != "assessment"
        and _match_entry(task, role=source_role, stage_name=source_stage_name)
        and (
            not isinstance(source_task_id, str)
            or source_task_id.strip() == ""
            or task.get("id") == source_task_id.strip()
        )
    ]
    if not source_tasks:
        return check, f"expected direct handoff {source_label}->{successor_label}, but no source task matched"

    source_ids = {
        task_id.strip()
        for task in source_tasks
        for task_id in [task.get("id")]
        if isinstance(task_id, str) and task_id.strip() != ""
    }
    source_time = max(
        (_task_timestamp(task) or datetime.min.replace(tzinfo=timezone.utc)) for task in source_tasks
    )

    if forbidden_task_kinds:
        blocking = sorted(
            {
                task_kind
                for task in workflow_tasks
                if isinstance(task, dict)
                for task_kind in [_task_kind(task)]
                if task_kind in forbidden_task_kinds and _task_subject_task_id(task) in source_ids
            }
        )
        if blocking:
            return (
                check,
                f"expected direct handoff {source_label}->{successor_label} without linked assessment, "
                f"found blocking assessment task kinds {blocking}",
            )

    successor_matches = [
        task
        for task in workflow_tasks
        if isinstance(task, dict)
        and _task_kind(task) != "assessment"
        and _match_entry(task, role=successor_role, stage_name=successor_stage_name)
        and (_task_timestamp(task) or datetime.min.replace(tzinfo=timezone.utc)) > source_time
    ]
    if len(successor_matches) < minimum_count:
        return (
            check,
            f"expected direct handoff {source_label}->{successor_label}, found {len(successor_matches)} matching successor tasks",
        )

    check["passed"] = True
    return check, None


def _evaluate_assessment_sequence(
    entry: dict[str, Any],
    *,
    workflow_tasks: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    subject_ids = _matching_subject_task_ids(
        workflow_tasks,
        subject_task_id=entry.get("subject_task_id"),
        subject_role=entry.get("subject_role"),
    )
    assessed_by = entry.get("assessed_by")
    subject_revision = entry.get("subject_revision")
    expected_resolutions = _expected_sequence(
        entry,
        singular_key="expected_resolution",
        plural_key="expected_resolutions",
    )
    subject_label = (
        str(entry.get("subject_task_id")).strip()
        if isinstance(entry.get("subject_task_id"), str) and str(entry.get("subject_task_id")).strip() != ""
        else str(entry.get("subject_role") or "<unknown>").strip()
    )
    assessor_label = str(assessed_by or "<unknown>").strip()
    check = {
        "name": f"assessment_sequences:{subject_label}:{assessor_label}",
        "passed": False,
    }

    matching_tasks = sorted(
        (
            task
            for task in workflow_tasks
            if isinstance(task, dict)
            and _task_kind(task) == "assessment"
            and _match_entry(task, role=assessed_by, stage_name=entry.get("stage_name"))
            and _task_subject_task_id(task) in subject_ids
            and (
                subject_revision is None
                or _task_subject_revision(task) == int(subject_revision)
            )
        ),
        key=lambda task: _task_timestamp(task) or datetime.min.replace(tzinfo=timezone.utc),
    )
    actual_resolutions = [
        resolution
        for task in matching_tasks
        for resolution in [_task_resolution(task)]
        if resolution is not None
    ]
    if actual_resolutions != expected_resolutions:
        return (
            check,
            f"expected assessment sequence for subject {subject_label!r} by assessor {assessor_label!r} "
            f"to equal {expected_resolutions!r}, got {actual_resolutions!r}",
        )

    check["passed"] = True
    return check, None


def _evaluate_approval_sequence(
    entry: dict[str, Any],
    *,
    approval_actions: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    match = entry.get("match")
    expected_actions = _expected_sequence(
        entry,
        singular_key="expected_action",
        plural_key="expected_actions",
    )
    match_mapping = match if isinstance(match, dict) else {}
    actual_actions = [
        str(action.get("action")).strip()
        for action in approval_actions
        if isinstance(action, dict)
        and all(action.get(key) == expected for key, expected in match_mapping.items())
        and isinstance(action.get("action"), str)
        and str(action.get("action")).strip() != ""
    ]
    check = {
        "name": f"approval_sequences:{match_mapping!r}",
        "passed": False,
    }
    if actual_actions != expected_actions:
        return (
            check,
            f"expected approval sequence for match {match_mapping!r} to equal {expected_actions!r}, got {actual_actions!r}",
        )
    check["passed"] = True
    return check, None


def _evaluate_subject_revision_expectation(
    entry: dict[str, Any],
    *,
    work_items_snapshot: Any,
    workflow_tasks: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    stage_name = entry.get("stage_name")
    subject_task_id = entry.get("subject_task_id")
    label = (
        stage_name.strip()
        if isinstance(stage_name, str) and stage_name.strip() != ""
        else str(subject_task_id or "<unknown>").strip()
    )
    check = {"name": f"subject_revision_expectations:{label}", "passed": False}
    actual_revision: int | None = None

    if isinstance(stage_name, str) and stage_name.strip() != "":
        revisions = [
            int(item.get("current_subject_revision"))
            for item in _work_items(work_items_snapshot)
            if isinstance(item, dict)
            and item.get("stage_name") == stage_name.strip()
            and isinstance(item.get("current_subject_revision"), int)
        ]
        actual_revision = max(revisions) if revisions else None
    elif isinstance(subject_task_id, str) and subject_task_id.strip() != "":
        revisions = [
            revision
            for task in workflow_tasks
            if isinstance(task, dict)
            and _task_subject_task_id(task) == subject_task_id.strip()
            for revision in [_task_subject_revision(task)]
            if revision is not None
        ]
        actual_revision = max(revisions) if revisions else None

    if "current_revision" in entry:
        expected_revision = int(entry["current_revision"])
        if actual_revision != expected_revision:
            return (
                check,
                f"expected subject revision for stage {label!r} to equal {expected_revision}, got {actual_revision}",
            )
    elif "minimum_revision" in entry:
        minimum_revision = int(entry["minimum_revision"])
        if actual_revision is None or actual_revision < minimum_revision:
            return (
                check,
                f"expected subject revision for stage {label!r} to be at least {minimum_revision}, got {actual_revision}",
            )

    check["passed"] = True
    return check, None


def _evaluate_required_assessment_set(
    entry: dict[str, Any],
    *,
    workflow_tasks: list[dict[str, Any]],
) -> tuple[dict[str, Any], str | None]:
    subject_ids = _matching_subject_task_ids(
        workflow_tasks,
        subject_task_id=entry.get("subject_task_id"),
        subject_role=entry.get("subject_role"),
    )
    required_assessors: list[str] = []
    for item in entry.get("required_assessors", []):
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if trimmed == "" or trimmed in required_assessors:
            continue
        required_assessors.append(trimmed)
    subject_revision = entry.get("subject_revision")
    required_resolution = str(entry.get("required_resolution", "approved")).strip()
    subject_label = (
        str(entry.get("subject_task_id")).strip()
        if isinstance(entry.get("subject_task_id"), str) and str(entry.get("subject_task_id")).strip() != ""
        else str(entry.get("subject_role") or "<unknown>").strip()
    )
    check = {"name": f"required_assessment_sets:{subject_label}", "passed": False}

    satisfied_assessors = {
        str(task.get("role")).strip()
        for task in workflow_tasks
        if isinstance(task, dict)
        and _task_kind(task) == "assessment"
        and _task_subject_task_id(task) in subject_ids
        and (
            subject_revision is None
            or _task_subject_revision(task) == int(subject_revision)
        )
        and _task_resolution(task) == required_resolution
        and isinstance(task.get("role"), str)
        and str(task.get("role")).strip() != ""
    }
    missing_assessors = [
        assessor for assessor in required_assessors if assessor not in satisfied_assessors
    ]
    if missing_assessors:
        revision_label = int(subject_revision) if subject_revision is not None else "any"
        return (
            check,
            f"expected required assessors {required_assessors!r} for subject {subject_label!r} "
            f"revision {revision_label}, missing {missing_assessors!r}",
        )

    check["passed"] = True
    return check, None


def evaluate_expectations(
    expectations: dict[str, Any],
    *,
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    stage_gates: Any | None = None,
    workspace: dict[str, Any],
    artifacts: Any,
    approval_actions: list[dict[str, Any]],
    events: Any | None = None,
    fleet: Any | None = None,
    playbook_id: str = "",
    fleet_peaks: dict[str, int] | None = None,
    efficiency: dict[str, Any] | None = None,
    execution_logs: Any | None = None,
    evidence: dict[str, Any] | None = None,
    verification_mode: str = STRICT_VERIFICATION_MODE,
    capability_expectations: dict[str, Any] | None = None,
    capability_setup: dict[str, Any] | None = None,
    capability_proof: dict[str, Any] | None = None,
) -> dict[str, Any]:
    failures: list[str] = []
    required_failures: list[str] = []
    checks: list[dict[str, Any]] = []
    evidence_payload = {} if evidence is None else evidence

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
        non_terminal = [item.get("id") for item in items if not _work_item_is_terminal(item, board)]
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

    work_item_matches = expectations.get("work_item_matches", [])
    if isinstance(work_item_matches, list):
        items = _work_items(work_items)
        for entry in work_item_matches:
            if not isinstance(entry, dict):
                continue
            match = entry.get("match", {})
            field_expectations = entry.get("field_expectations", {})
            if not isinstance(match, dict) or not isinstance(field_expectations, dict):
                continue
            matches = _find_matching_entries(items, match)
            passed = len(matches) > 0 and any(
                _matches_field_expectations(item, field_expectations) for item in matches
            )
            checks.append({"name": f"work_item_matches:{match}", "passed": passed})
            if not passed:
                failures.append(
                    f"expected work item matching {match!r} with fields {field_expectations!r}"
                )

    stage_gate_matches = expectations.get("stage_gate_matches", [])
    if isinstance(stage_gate_matches, list):
        gates = _stage_gates(stage_gates)
        for entry in stage_gate_matches:
            if not isinstance(entry, dict):
                continue
            match = entry.get("match", {})
            field_expectations = entry.get("field_expectations", {})
            if not isinstance(match, dict) or not isinstance(field_expectations, dict):
                continue
            matches = _find_matching_entries(gates, match)
            passed = len(matches) > 0 and any(
                _matches_field_expectations(item, field_expectations) for item in matches
            )
            checks.append({"name": f"stage_gate_matches:{match}", "passed": passed})
            if not passed:
                failures.append(
                    f"expected stage gate matching {match!r} with fields {field_expectations!r}"
                )

    board_expectations = expectations.get("board", {})
    if isinstance(board_expectations, dict) and "blocked_count" in board_expectations:
        blocked_items = _count_blocked_board_items(board)
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
        forbidden_task_kinds = sorted(
            {
                item.strip()
                for item in workflow_task_expectations.get("forbid_task_kinds", [])
                if isinstance(item, str) and item.strip() != ""
            }
        )
        if forbidden_task_kinds:
            actual_forbidden = sorted(
                {
                    task_kind
                    for task in non_orchestrator_tasks
                    for task_kind in [_task_kind(task)]
                    if task_kind in forbidden_task_kinds
                }
            )
            passed = len(actual_forbidden) == 0
            checks.append(
                {
                    "name": "workflow_tasks.forbid_task_kinds",
                    "passed": passed,
                    "expected_forbidden": forbidden_task_kinds,
                    "actual_forbidden": actual_forbidden,
                }
            )
            if not passed:
                failures.append(
                    f"expected workflow to avoid task kinds {forbidden_task_kinds}, found {actual_forbidden}"
                )

    workflow_tasks = [task for task in _workflow_tasks(workflow) if isinstance(task, dict)]

    task_backend_expectations = expectations.get("task_backend_expectations", [])
    if isinstance(task_backend_expectations, list):
        for entry in task_backend_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_task_backend_expectation(entry, workflow_tasks=workflow_tasks)
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    structured_breakout_expectations = expectations.get("structured_breakout_expectations", [])
    if isinstance(structured_breakout_expectations, list):
        for entry in structured_breakout_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_structured_breakout_expectation(
                entry,
                workflow_tasks=workflow_tasks,
                work_items_snapshot=work_items,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    log_row_expectations = expectations.get("log_row_expectations", [])
    if isinstance(log_row_expectations, list):
        log_rows = execution_log_rows(execution_logs)
        for entry in log_row_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_log_row_expectation(entry, log_rows=log_rows)
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    container_observation_expectations = expectations.get("container_observation_expectations", [])
    if isinstance(container_observation_expectations, list):
        observed_rows = container_observation_rows(evidence_payload.get("container_observations"))
        for entry in container_observation_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_container_observation_expectation(
                entry,
                observed_rows=observed_rows,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    evidence_expectations = expectations.get("evidence_expectations", {})
    if isinstance(evidence_expectations, dict):
        if "db_state_present" in evidence_expectations:
            passed = bool((evidence_payload.get("db_state") or {}).get("ok")) is bool(
                evidence_expectations["db_state_present"]
            )
            checks.append({"name": "evidence_expectations.db_state_present", "passed": passed})
            if not passed:
                failures.append("expected DB evidence to be present")
        if "runtime_cleanup_passed" in evidence_expectations:
            passed = bool((evidence_payload.get("runtime_cleanup") or {}).get("all_clean")) is bool(
                evidence_expectations["runtime_cleanup_passed"]
            )
            checks.append({"name": "evidence_expectations.runtime_cleanup_passed", "passed": passed})
            if not passed:
                failures.append("expected runtime cleanup evidence to pass")
        if "docker_log_rotation_passed" in evidence_expectations:
            passed = bool(
                (evidence_payload.get("docker_log_rotation") or {}).get("all_runtime_containers_bounded")
            ) is bool(evidence_expectations["docker_log_rotation_passed"])
            checks.append({"name": "evidence_expectations.docker_log_rotation_passed", "passed": passed})
            if not passed:
                failures.append("expected Docker log rotation evidence to pass")
        if "log_anomalies_empty" in evidence_expectations:
            anomalies = evidence_payload.get("log_anomalies", {})
            passed = len(anomalies.get("rows", [])) == 0 if isinstance(anomalies, dict) else False
            passed = passed is bool(evidence_expectations["log_anomalies_empty"])
            checks.append({"name": "evidence_expectations.log_anomalies_empty", "passed": passed})
            if not passed:
                failures.append("expected execution-log anomaly review to be empty")
        if "distinct_orchestrator_runtime_count_min" in evidence_expectations:
            minimum = evidence_expectations["distinct_orchestrator_runtime_count_min"]
            actual = len(_distinct_orchestrator_runtime_actors(execution_logs))
            passed = isinstance(minimum, int) and actual >= minimum
            checks.append(
                {
                    "name": "evidence_expectations.distinct_orchestrator_runtime_count_min",
                    "passed": passed,
                    "expected_min": minimum,
                    "actual": actual,
                }
            )
            if not passed:
                failures.append(
                    f"expected at least {minimum} distinct orchestrator runtime actor(s), found {actual}"
                )

    capability_result = evaluate_capability_expectations(
        expectations={} if capability_expectations is None else capability_expectations,
        setup={} if capability_setup is None else capability_setup,
        proof={} if capability_proof is None else capability_proof,
    )
    if capability_expectations:
        checks.append(
            {
                "name": "capabilities",
                "passed": capability_result["passed"],
                "failures": capability_result["failures"],
            }
        )
        failures.extend(capability_result["failures"])
        required_failures.extend(capability_result["failures"])

    fleet_expectations = expectations.get("fleet", {})
    if isinstance(fleet_expectations, dict):
        pool_expectations = fleet_expectations.get("playbook_pool", {})
        if isinstance(pool_expectations, dict) and pool_expectations:
            pool = _playbook_pool_status(fleet, playbook_id=playbook_id)
            requires_current_pool = _fleet_pool_requires_current_snapshot(pool_expectations)
            if pool is None and requires_current_pool:
                checks.append(
                    {
                        "name": "fleet.playbook_pool.present",
                        "passed": False,
                        "playbook_id": playbook_id,
                    }
                )
                failures.append(f"expected fleet pool entry for playbook {playbook_id!r}")
            else:
                if pool is not None:
                    checks.append(
                        {
                            "name": "fleet.playbook_pool.present",
                            "passed": True,
                            "playbook_id": playbook_id,
                        }
                    )
                for field in ("max_runtimes", "active_workflows"):
                    if field not in pool_expectations:
                        continue
                    expected_value = int(pool_expectations[field])
                    actual_value = int((pool or {}).get(field, 0))
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
            rework_stage_name = entry.get("rework_stage_name", stage_name)
            if not isinstance(rework_stage_name, str) or rework_stage_name.strip() == "":
                rework_stage_name = stage_name
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
                    if data.get("stage_name") != rework_stage_name:
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
            else:
                request_at = _approval_action_timestamp(
                    approval_actions,
                    stage_name=stage_name,
                    action=request_action,
                )
                resume_at = _approval_action_timestamp(
                    approval_actions,
                    stage_name=stage_name,
                    action=resume_action,
                    after=request_at,
                )

            if not matched and request_at is not None and resume_at is not None:
                for task in workflow_tasks:
                    if not isinstance(task, dict):
                        continue
                    if task.get("stage_name") != rework_stage_name:
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
                    f"expected {required_event_type!r} for rework stage {rework_stage_name!r} after "
                    f"gate stage {stage_name!r} "
                    f"between "
                    f"stage.gate.{request_action} and stage.gate.{resume_action}"
                )

    task_rework_sequences = expectations.get("task_rework_sequences", [])
    if isinstance(task_rework_sequences, list):
        event_list = sorted(
            _workflow_events(events),
            key=lambda entry: _parse_timestamp(entry.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        )
        workflow_tasks = _workflow_tasks(workflow)
        for entry in task_rework_sequences:
            if not isinstance(entry, dict):
                continue
            stage_name = entry.get("stage_name")
            if not isinstance(stage_name, str) or stage_name.strip() == "":
                continue
            request_event_type = str(entry.get("request_event_type", "task.assessment_requested_changes"))
            resume_event_type = str(entry.get("resume_event_type", "task.approved"))
            required_event_type = str(entry.get("required_event_type", "task.handoff_submitted"))
            required_role = entry.get("required_role")
            require_non_orchestrator = bool(entry.get("require_non_orchestrator", True))

            matched = _matches_rework_sequence(
                event_list=event_list,
                workflow_tasks=workflow_tasks,
                stage_name=stage_name,
                request_event_type=request_event_type,
                resume_event_type=resume_event_type,
                required_event_type=required_event_type,
                required_role=required_role,
                require_non_orchestrator=require_non_orchestrator,
            )
            check_name = (
                f"task_rework_sequences:{stage_name}:{request_event_type}->{required_event_type}->{resume_event_type}"
            )
            checks.append({"name": check_name, "passed": matched})
            if not matched:
                failures.append(
                    f"expected specialist rework for stage {stage_name!r} between "
                    f"{request_event_type!r} and {resume_event_type!r}"
                )

    continuity_rework_sequences = expectations.get("continuity_rework_sequences", [])
    if isinstance(continuity_rework_sequences, list):
        workflow_tasks = _workflow_tasks(workflow)
        for entry in continuity_rework_sequences:
            if not isinstance(entry, dict):
                continue
            stage_name = entry.get("stage_name")
            required_role = entry.get("required_role")
            if not isinstance(stage_name, str) or stage_name.strip() == "":
                continue
            if not isinstance(required_role, str) or required_role.strip() == "":
                continue
            minimum_rework_count = int(entry.get("minimum_rework_count", 1))
            assessment_stage_name = str(entry.get("assessment_stage_name", stage_name))
            assessment_task_min_count = int(entry.get("assessment_task_min_count", 1))
            matched = _matches_continuity_rework_sequence(
                work_items_snapshot=work_items,
                execution_logs=execution_logs,
                workflow_tasks=workflow_tasks,
                stage_name=stage_name,
                required_role=required_role,
                minimum_rework_count=minimum_rework_count,
                assessment_stage_name=assessment_stage_name,
                assessment_task_min_count=assessment_task_min_count,
            )
            check_name = f"continuity_rework_sequences:{stage_name}:{required_role}"
            checks.append({"name": check_name, "passed": matched})
            if not matched:
                failures.append(
                    f"expected continuity-backed rework for stage {stage_name!r} "
                    f"with role {required_role!r}"
                )

    workflow_tasks = _workflow_tasks(workflow)

    direct_handoff_expectations = expectations.get("direct_handoff_expectations", [])
    if isinstance(direct_handoff_expectations, list):
        for entry in direct_handoff_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_direct_handoff_expectation(
                entry,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    assessment_sequences = expectations.get("assessment_sequences", [])
    if isinstance(assessment_sequences, list):
        for entry in assessment_sequences:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_assessment_sequence(
                entry,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    approval_sequences = expectations.get("approval_sequences", [])
    if isinstance(approval_sequences, list):
        for entry in approval_sequences:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_approval_sequence(
                entry,
                approval_actions=approval_actions,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    approval_before_assessment_sequences = expectations.get("approval_before_assessment_sequences", [])
    if isinstance(approval_before_assessment_sequences, list):
        for entry in approval_before_assessment_sequences:
            if not isinstance(entry, dict):
                continue
            match = entry.get("match", {})
            if not isinstance(match, dict) or not match:
                continue
            assessed_by = entry.get("assessed_by")
            if not isinstance(assessed_by, str) or assessed_by.strip() == "":
                continue
            approval_action = str(entry.get("approval_action", "approve"))
            assessment_stage_name = entry.get("assessment_stage_name")
            approval_times = [
                _parse_timestamp(action.get("submitted_at"))
                for action in approval_actions
                if isinstance(action, dict)
                and action.get("action") == approval_action
                and _matches_field_expectations(action, match)
            ]
            approval_times = [value for value in approval_times if value is not None]
            assessment_times = [
                _task_timestamp(task)
                for task in workflow_tasks
                if isinstance(task, dict)
                and _task_kind(task) == "assessment"
                and task.get("role") == assessed_by.strip()
                and (
                    not isinstance(assessment_stage_name, str)
                    or assessment_stage_name.strip() == ""
                    or task.get("stage_name") == assessment_stage_name.strip()
                )
            ]
            assessment_times = [value for value in assessment_times if value is not None]
            passed = bool(approval_times) and bool(assessment_times) and min(approval_times) <= min(assessment_times)
            checks.append(
                {
                    "name": f"approval_before_assessment_sequences:{match}:{assessed_by.strip()}",
                    "passed": passed,
                }
            )
            if not passed:
                failures.append(
                    f"expected approval {approval_action!r} for {match!r} before assessment role {assessed_by.strip()!r}"
                )

    subject_revision_expectations = expectations.get("subject_revision_expectations", [])
    if isinstance(subject_revision_expectations, list):
        for entry in subject_revision_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_subject_revision_expectation(
                entry,
                work_items_snapshot=work_items,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    required_assessment_sets = expectations.get("required_assessment_sets", [])
    if isinstance(required_assessment_sets, list):
        for entry in required_assessment_sets:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_required_assessment_set(
                entry,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    efficiency_expectations = expectations.get("efficiency", {})
    if isinstance(efficiency_expectations, dict) and efficiency_expectations:
        efficiency_checks, efficiency_failures = evaluate_efficiency_expectations(
            efficiency_expectations,
            efficiency,
        )
        checks.extend(efficiency_checks)
        failures.extend(efficiency_failures)

    if verification_mode == OUTCOME_DRIVEN_VERIFICATION_MODE:
        outcome_checks, outcome_failures = evaluate_outcome_driven_basics(
            expectations,
            workflow=workflow,
            work_items=work_items,
            board=board,
            artifacts=artifacts,
            evidence=evidence_payload,
            execution_logs=execution_logs,
        )
        required_failure_set = set(required_failures)
        return {
            "passed": len(outcome_failures) == 0 and len(required_failures) == 0,
            "failures": [*outcome_failures, *required_failures],
            "checks": [*checks, *outcome_checks],
            "advisories": [
                failure
                for failure in failures
                if failure not in required_failure_set
            ],
            "approval_actions": approval_actions,
        }

    return {
        "passed": len(failures) == 0,
        "failures": failures,
        "checks": checks,
        "advisories": [],
        "approval_actions": approval_actions,
    }


def progress_verification_requires_full_evidence(
    expectations: dict[str, Any],
    verification_mode: str,
) -> bool:
    if verification_mode == OUTCOME_DRIVEN_VERIFICATION_MODE:
        return True
    return any(
        isinstance(expectations.get(key), list) and len(expectations.get(key, [])) > 0
        for key in ("task_rework_sequences", "continuity_rework_sequences")
    ) or bool(expectations.get("efficiency"))


def progress_verification_candidate_ready(
    expectations: dict[str, Any],
    *,
    workflow: dict[str, Any],
    work_items: Any,
    board: Any,
    verification_mode: str = "",
) -> bool:
    if verification_mode == OUTCOME_DRIVEN_VERIFICATION_MODE:
        outcome_envelope = expectations.get("outcome_envelope", {})
        allowed_states = outcome_envelope.get("allowed_states")
        if isinstance(allowed_states, list) and allowed_states:
            if workflow.get("state") not in allowed_states:
                return False
    else:
        expected_state = expectations.get("state")
        if expected_state is not None and workflow.get("state") != expected_state:
            return False

    work_item_expectations = expectations.get("work_items", {})
    if not isinstance(work_item_expectations, dict):
        return True

    items = _work_items(work_items)
    if "min_count" in work_item_expectations and len(items) < int(work_item_expectations["min_count"]):
        return False
    if work_item_expectations.get("all_terminal"):
        return all(_work_item_is_terminal(item, board) for item in items)
    return True


def progress_verification_can_end_run(
    verification: dict[str, Any],
    *,
    workflow: dict[str, Any],
    verification_mode: str = "",
) -> bool:
    if not bool(verification.get("passed")):
        return False
    advisories = verification.get("advisories", [])
    if (
        verification_mode != OUTCOME_DRIVEN_VERIFICATION_MODE
        and isinstance(advisories, list)
        and len(advisories) > 0
    ):
        return False

    active_states = {
        "pending",
        "ready",
        "claimed",
        "in_progress",
        "awaiting_approval",
        "output_pending_assessment",
    }
    for task in _workflow_tasks(workflow):
        if not isinstance(task, dict):
            continue
        if str(task.get("state") or "") in active_states:
            return False
    return True


def evaluate_progress_expectations(
    client: ApiClient,
    *,
    workflow_id: str,
    expectations: dict[str, Any],
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    stage_gates: Any,
    workspace: dict[str, Any],
    artifacts: Any,
    approval_actions: list[dict[str, Any]],
    fleet: Any,
    playbook_id: str,
    fleet_peaks: dict[str, int] | None,
    verification_mode: str,
    trace: TraceRecorder | None,
    execution_environment_expectations: dict[str, Any] | None = None,
    capability_expectations: dict[str, Any] | None = None,
    capability_setup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workflow_with_tasks = attach_workflow_tasks(workflow, fetch_workflow_tasks(client, workflow_id=workflow_id))
    progress_capability_proof = build_capability_proof(workflow=workflow_with_tasks, logs=None)
    verification = evaluate_expectations(
        expectations,
        workflow=workflow_with_tasks,
        board=board,
        work_items=work_items,
        stage_gates=stage_gates,
        workspace=workspace,
        artifacts=artifacts,
        approval_actions=approval_actions,
        events={"ok": True, "data": []},
        fleet=fleet,
        playbook_id=playbook_id,
        fleet_peaks=fleet_peaks,
        efficiency=None,
        execution_logs=None,
        verification_mode=verification_mode,
        evidence={},
        capability_expectations=capability_expectations,
        capability_setup=capability_setup,
        capability_proof=progress_capability_proof,
    )
    if verification["passed"]:
        return verification
    if not progress_verification_requires_full_evidence(expectations, verification_mode):
        return verification
    if not progress_verification_candidate_ready(
        expectations,
        workflow=workflow,
        work_items=work_items,
        board=board,
        verification_mode=verification_mode,
    ):
        return verification

    events_snapshot = collect_workflow_events(client, workflow_id=workflow_id)
    execution_logs_snapshot = collect_execution_logs(client, workflow_id=workflow_id)
    live_containers_snapshot = collect_live_container_snapshot(client, label="containers.list.progress")
    evidence_payload: dict[str, Any] = {
        "db_state": collect_db_state_snapshot(trace, workflow_id=workflow_id),
        "log_anomalies": summarize_log_anomalies(execution_logs_snapshot),
        "live_containers": live_containers_snapshot,
        "runtime_cleanup": inspect_runtime_cleanup(
            live_containers_snapshot.get("data"),
            trace=trace,
            relevant_task_ids=_workflow_task_ids(workflow_with_tasks),
        )
        if live_containers_snapshot.get("ok")
        else {"all_clean": False, "error": live_containers_snapshot.get("error")},
    }
    evidence_payload["execution_environment_usage"] = summarize_execution_environment_usage(
        execution_environment_expectations,
        evidence_payload.get("db_state"),
    )
    evidence_payload["capability_proof"] = build_capability_proof(
        workflow=workflow_with_tasks,
        logs=execution_logs_snapshot,
    )
    efficiency_summary = summarize_efficiency(
        workflow=workflow_with_tasks,
        logs=execution_logs_snapshot,
        events=events_snapshot,
        approval_actions=approval_actions,
    )
    return evaluate_expectations(
        expectations,
        workflow=workflow_with_tasks,
        board=board,
        work_items=work_items,
        stage_gates=stage_gates,
        workspace=workspace,
        artifacts=artifacts,
        approval_actions=approval_actions,
        events=events_snapshot,
        fleet=fleet,
        playbook_id=playbook_id,
        fleet_peaks=fleet_peaks,
        efficiency=efficiency_summary,
        execution_logs=execution_logs_snapshot,
        evidence=evidence_payload,
        verification_mode=verification_mode,
        capability_expectations=capability_expectations,
        capability_setup=capability_setup,
        capability_proof=evidence_payload["capability_proof"],
    )


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


def normalize_playbook_launch_inputs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    launch_inputs: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        slug = str(entry.get("slug") or "").strip()
        title = str(entry.get("title") or "").strip()
        if slug == "" or title == "":
            continue
        launch_inputs.append(
            {
                "slug": slug,
                "title": title,
                "required": bool(entry.get("required", False)),
            }
        )
    return launch_inputs


def build_declared_workflow_parameters(
    *,
    playbook_launch_inputs: list[dict[str, Any]],
    scenario_name: str,
    workflow_goal: str,
    workflow_parameters: dict[str, Any] | None,
) -> dict[str, str]:
    declared_inputs = normalize_playbook_launch_inputs(playbook_launch_inputs)
    provided_parameters = {} if workflow_parameters is None else dict(workflow_parameters)
    declared_slugs = {entry["slug"] for entry in declared_inputs}
    parameters = {
        key: value
        for key, value in provided_parameters.items()
        if key in declared_slugs
    }

    if "goal" in declared_slugs and "goal" not in parameters:
        parameters["goal"] = workflow_goal
    if "scenario_name" in declared_slugs and "scenario_name" not in parameters:
        parameters["scenario_name"] = scenario_name

    normalized: dict[str, str] = {}
    for entry in declared_inputs:
        slug = entry["slug"]
        value = parameters.get(slug)
        trimmed = value.strip() if isinstance(value, str) else ""
        if trimmed:
            normalized[slug] = trimmed
            continue
        if bool(entry.get("required", False)):
            raise RuntimeError(f"missing required playbook launch input slug: {slug}")
    return normalized


def build_workflow_create_payload(
    *,
    playbook_id: str,
    workspace_id: str,
    workflow_name: str,
    scenario_name: str,
    workflow_goal: str,
    playbook_launch_inputs: list[dict[str, Any]] | None = None,
    workflow_parameters: dict[str, Any] | None = None,
    workflow_metadata: dict[str, Any] | None = None,
    execution_environment: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "playbook_id": playbook_id,
        "workspace_id": workspace_id,
        "name": workflow_name,
        "parameters": build_declared_workflow_parameters(
            playbook_launch_inputs=[] if playbook_launch_inputs is None else playbook_launch_inputs,
            scenario_name=scenario_name,
            workflow_goal=workflow_goal,
            workflow_parameters=workflow_parameters,
        ),
        "metadata": {
            **({} if workflow_metadata is None else workflow_metadata),
            "live_test": {
                "scenario_name": scenario_name,
                **(
                    {}
                    if execution_environment is None
                    else {"execution_environment": execution_environment}
                ),
            },
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
            ("branch_key_template", "branch_key"),
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
    board_snapshot: Any,
) -> bool:
    wait_for = action.get("wait_for", {})
    if not isinstance(wait_for, dict) or not wait_for:
        return True

    expected_workflow_state = wait_for.get("workflow_state")
    if expected_workflow_state is not None and workflow.get("state") != expected_workflow_state:
        return False

    if "completed_work_items_min" in wait_for:
        if _completed_work_item_count(work_items_snapshot, board_snapshot) < int(wait_for["completed_work_items_min"]):
            return False

    if "total_work_items_min" in wait_for:
        if len(_work_items(work_items_snapshot)) < int(wait_for["total_work_items_min"]):
            return False

    if "open_work_items_max" in wait_for:
        if _open_work_item_count(work_items_snapshot, board_snapshot) > int(wait_for["open_work_items_max"]):
            return False

    if "all_work_items_terminal" in wait_for:
        expected = bool(wait_for["all_work_items_terminal"])
        actual = _open_work_item_count(work_items_snapshot, board_snapshot) == 0
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
    board_snapshot: Any,
) -> tuple[int, list[dict[str, Any]]]:
    executed: list[dict[str, Any]] = []
    current_index = next_action_index
    while current_index < len(actions):
        action = actions[current_index]
        if not workflow_action_wait_conditions_met(
            action,
            workflow=workflow,
            work_items_snapshot=work_items_snapshot,
            board_snapshot=board_snapshot,
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


def collect_workflow_stage_gates(client: ApiClient, *, workflow_id: str) -> dict[str, Any]:
    return client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/gates",
        expected=(200,),
        label="workflows.gates",
    )


def build_run_result_payload(
    *,
    workflow_id: str,
    final_state: str,
    timed_out: bool,
    poll_iterations: int,
    scenario_name: str,
    approval_mode: str,
    provider_auth_mode: str,
    verification_mode: str,
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    stage_gates: Any | None = None,
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
    evidence: dict[str, Any] | None = None,
    execution_environment: dict[str, Any] | None = None,
    capability_proof: dict[str, Any] | None = None,
) -> dict[str, Any]:
    verification_payload = {} if verification is None else verification
    efficiency_payload = {} if efficiency is None else efficiency
    evidence_payload = {} if evidence is None else evidence
    specialist_teardown = efficiency_payload.get("specialist_teardown")
    if not isinstance(specialist_teardown, dict):
        specialist_teardown = {}
    brief_proof = build_brief_proof(workflow=workflow, logs=execution_logs)
    outcome_metrics = evidence_payload.get("scenario_outcome_metrics")
    if not isinstance(outcome_metrics, dict):
        outcome_metrics = build_scenario_outcome_metrics(
            final_state=final_state,
            verification=verification_payload,
            workflow=workflow,
            board=board,
            work_items=work_items,
            stage_gates=stage_gates,
            artifacts=artifacts,
            approval_actions=approval_actions,
            workflow_actions=workflow_actions,
            execution_logs=execution_logs,
            evidence=evidence_payload,
        )
    return {
        "workflow_id": workflow_id,
        "runner_exit_code": 0 if bool(verification_payload.get("passed")) else 1,
        "state": final_state,
        "workflow_state": final_state,
        "terminal": final_state in TERMINAL_STATES,
        "timed_out": timed_out,
        "poll_iterations": poll_iterations,
        "scenario": scenario_name,
        "scenario_name": scenario_name,
        "approval_mode": approval_mode,
        "provider_auth_mode": provider_auth_mode,
        "verification_mode": verification_mode,
        "workflow": workflow,
        "board": board,
        "work_items": work_items,
        "stage_gates": stage_gates,
        "events": events,
        "approvals": approvals,
        "approval_actions": approval_actions,
        "workflow_actions": workflow_actions,
        "workspace": workspace,
        "artifacts": artifacts,
        "fleet": fleet,
        "fleet_peaks": fleet_peaks,
        "execution_logs": execution_logs,
        "execution_environment": execution_environment,
        "evidence": evidence_payload,
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
        "orchestrator_max_llm_turns_per_attempt": efficiency_payload.get(
            "orchestrator_max_llm_turns_per_attempt"
        ),
        "non_orchestrator_max_llm_turns_per_attempt": efficiency_payload.get(
            "non_orchestrator_max_llm_turns_per_attempt"
        ),
        "specialist_teardown_lag_seconds": specialist_teardown.get("max_lag_seconds"),
        "brief_proof": brief_proof,
        "capability_proof": {} if capability_proof is None else capability_proof,
        "outcome_metrics": outcome_metrics,
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
        if row.get("operation") == "task.execute" and row.get("status") == "started":
            task_id = row.get("task_id")
            if not isinstance(task_id, str) or task_id.strip() == "" or task_id in seen_task_ids:
                continue
            if task_orchestrator_flags.get(task_id):
                continue
            payload = row.get("payload")
            if not isinstance(payload, dict):
                continue
            task_entries.append(
                {
                    "task_id": task_id,
                    "role": task_roles.get(task_id) or None,
                    "execution_brief_present": bool(payload.get("execution_brief_present")),
                    "execution_brief_path": "/workspace/context/execution-brief.json",
                    "execution_brief_excerpt": payload.get("execution_brief_excerpt"),
                    "execution_brief_hash": payload.get("execution_brief_hash"),
                    "execution_brief_refresh_key": payload.get("execution_brief_refresh_key"),
                    "execution_brief_current_focus": payload.get("execution_brief_current_focus"),
                    "execution_brief_predecessor_handoff_id": payload.get("execution_brief_predecessor_handoff_id"),
                    "execution_brief_memory_ref_keys": payload.get("execution_brief_memory_ref_keys"),
                    "execution_brief_artifact_paths": payload.get("execution_brief_artifact_paths"),
                    "system_prompt_contains_workflow_brief": False,
                    "system_prompt_contains_current_focus": False,
                    "system_prompt_contains_predecessor_context": False,
                    "source": "task.execute.started",
                }
            )
            seen_task_ids.add(task_id)
            continue

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
                "execution_brief_hash": None,
                "execution_brief_refresh_key": None,
                "execution_brief_current_focus": None,
                "execution_brief_predecessor_handoff_id": None,
                "execution_brief_memory_ref_keys": None,
                "execution_brief_artifact_paths": None,
                "system_prompt_contains_workflow_brief": any(
                    "## Workflow Brief" in message for message in system_messages
                ),
                "system_prompt_contains_current_focus": any(
                    "## Current Focus" in message for message in system_messages
                ),
                "system_prompt_contains_predecessor_context": any(
                    "## Predecessor Context" in message for message in system_messages
                ),
                "source": "llm.chat_stream.started",
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


def emit_run_result(payload: dict[str, Any]) -> None:
    serialized = json.dumps(payload)
    output_path = env("LIVE_TEST_SCENARIO_RUN_TMP_FILE", "")
    if output_path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(serialized, encoding="utf-8")
        return
    print(serialized)


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
    verification_mode = env("LIVE_TEST_VERIFICATION_MODE", OUTCOME_DRIVEN_VERIFICATION_MODE)
    timeout_seconds = scenario["timeout_seconds"] if scenario else env_int("LIVE_TEST_WORKFLOW_TIMEOUT_SECONDS", 1800)
    poll_interval_seconds = scenario["poll_interval_seconds"] if scenario else env_int("LIVE_TEST_POLL_INTERVAL_SECONDS", 10)

    bootstrap_context = read_json(bootstrap_context_file)
    workspace_id = env("LIVE_TEST_WORKSPACE_ID", bootstrap_context["workspace_id"], required=True)
    playbook_id = env("LIVE_TEST_PLAYBOOK_ID", bootstrap_context["playbook_id"], required=True)
    playbook_launch_inputs = normalize_playbook_launch_inputs(bootstrap_context.get("playbook_launch_inputs"))
    capability_setup = {
        "skills": bootstrap_context.get("profile_skills", []),
        "remote_mcp_servers": bootstrap_context.get("profile_remote_mcp_servers", []),
        "roles": bootstrap_context.get("profile_roles", []),
    }
    selected_execution_environment = (
        dict(bootstrap_context["default_execution_environment"])
        if isinstance(bootstrap_context.get("default_execution_environment"), dict)
        else None
    )
    tenant_default_execution_environment = (
        dict(bootstrap_context["tenant_default_execution_environment"])
        if isinstance(bootstrap_context.get("tenant_default_execution_environment"), dict)
        else None
    )
    execution_environment_expectations = {
        "selected_default_environment_id": None
        if selected_execution_environment is None
        else selected_execution_environment.get("id"),
        "tenant_default_environment_id": None
        if tenant_default_execution_environment is None
        else tenant_default_execution_environment.get("id"),
        "roles": bootstrap_context.get("profile_roles", []),
    }
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
    capability_expectation_plan = {} if scenario is None else scenario["capabilities"]
    initial_remote_mcp_fixture_snapshot = capture_remote_mcp_fixture_snapshot()

    trace = TraceRecorder(trace_dir)
    public_client = ApiClient(base_url, trace)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token, lambda: login(public_client, admin_api_key))

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
                playbook_launch_inputs=playbook_launch_inputs,
                workflow_parameters={} if scenario is None else scenario["workflow"]["parameters"],
                workflow_metadata={} if scenario is None else scenario["workflow"]["metadata"],
                execution_environment=selected_execution_environment,
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
        board_snapshot={"ok": True, "data": {"columns": [], "work_items": []}},
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
    live_container_observations = new_container_observations()
    latest_live_containers: Any = {"ok": False, "error": "not_collected"}

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
        board_for_actions = None
        if next_action_index < len(action_plan):
            board_for_actions = client.best_effort_request(
                "GET",
                f"/api/v1/workflows/{workflow_id}/board",
                expected=(200,),
                label="workflows.board.actions",
            )
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
                board_snapshot=board_for_actions,
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
        latest_live_containers = collect_live_container_snapshot(client, label="containers.list.progress")
        if latest_live_containers.get("ok"):
            observe_live_containers(live_container_observations, latest_live_containers.get("data"))
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
            stage_gates_snapshot = collect_workflow_stage_gates(client, workflow_id=workflow_id)
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
            progress_verification = evaluate_progress_expectations(
                client,
                workflow_id=workflow_id,
                expectations=expectation_plan,
                workflow=latest_workflow,
                board=board_snapshot,
                work_items=work_items_snapshot,
                stage_gates=stage_gates_snapshot,
                workspace=workspace_snapshot,
                artifacts=artifacts_snapshot,
                approval_actions=approval_actions,
                fleet=latest_fleet,
                playbook_id=playbook_id,
            fleet_peaks=fleet_peaks,
            verification_mode=verification_mode,
            trace=trace,
            execution_environment_expectations=execution_environment_expectations,
            capability_expectations=capability_expectation_plan,
            capability_setup=capability_setup,
        )
            if progress_verification_can_end_run(
                progress_verification,
                workflow=attach_workflow_tasks(
                    latest_workflow,
                    fetch_workflow_tasks(client, workflow_id=workflow_id),
                ),
                verification_mode=verification_mode,
            ):
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
    latest_workflow = attach_workflow_tasks(
        latest_workflow,
        fetch_workflow_tasks(client, workflow_id=workflow_id),
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
    stage_gates_snapshot = collect_workflow_stage_gates(client, workflow_id=workflow_id)
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
    latest_live_containers, runtime_cleanup_evidence, docker_log_rotation_evidence = settle_final_live_container_evidence(
        client,
        max_attempts=final_settle_attempts,
        delay_seconds=final_settle_delay_seconds,
        trace=trace,
        live_container_observations=live_container_observations,
        relevant_task_ids=_workflow_task_ids(latest_workflow),
    )
    execution_logs_snapshot = collect_execution_logs(client, workflow_id=workflow_id)
    efficiency_summary = summarize_efficiency(
        workflow=latest_workflow,
        logs=execution_logs_snapshot,
        events=events_snapshot,
        approval_actions=approval_actions,
    )
    db_state_snapshot = collect_db_state_snapshot(trace, workflow_id=workflow_id)
    workspace_scope_trace = build_workspace_scope_trace(
        client,
        workflow_id=workflow_id,
        workflow=latest_workflow,
        db_state=db_state_snapshot,
        execution_logs=execution_logs_snapshot,
    )
    evidence_payload = {
        "db_state": db_state_snapshot,
        "execution_environment_usage": summarize_execution_environment_usage(
            execution_environment_expectations,
            db_state_snapshot,
        ),
        "log_anomalies": summarize_log_anomalies(execution_logs_snapshot),
        "http_status_summary": summarize_http_status_anomalies(execution_logs_snapshot),
        "live_containers": latest_live_containers,
        "container_observations": finalize_container_observations(live_container_observations),
        "runtime_cleanup": runtime_cleanup_evidence,
        "docker_log_rotation": docker_log_rotation_evidence,
        "workspace_scope_trace": workspace_scope_trace,
    }
    remote_mcp_fixture_activity = summarize_remote_mcp_fixture_activity(
        before_snapshot=initial_remote_mcp_fixture_snapshot,
        after_snapshot=capture_remote_mcp_fixture_snapshot(),
        capability_setup=capability_setup,
    )
    evidence_payload["remote_mcp_fixture"] = remote_mcp_fixture_activity
    capability_proof = merge_remote_mcp_fixture_into_capability_proof(
        build_capability_proof(workflow=latest_workflow, logs=execution_logs_snapshot),
        remote_mcp_fixture_activity,
    )
    evidence_payload["capability_proof"] = capability_proof
    final_state = latest_workflow.get("state")
    verification = evaluate_expectations(
        expectation_plan,
        workflow=latest_workflow,
        board=board_snapshot,
        work_items=work_items_snapshot,
        stage_gates=stage_gates_snapshot,
        workspace=workspace_snapshot,
        artifacts=artifacts_snapshot,
        approval_actions=approval_actions,
        events=events_snapshot,
        fleet=latest_fleet,
        playbook_id=playbook_id,
        fleet_peaks=fleet_peaks,
        efficiency=efficiency_summary,
        execution_logs=execution_logs_snapshot,
        evidence=evidence_payload,
        verification_mode=verification_mode,
        capability_expectations=capability_expectation_plan,
        capability_setup=capability_setup,
        capability_proof=capability_proof,
    )
    evidence_payload["scenario_outcome_metrics"] = build_scenario_outcome_metrics(
        final_state=final_state,
        verification=verification,
        workflow=latest_workflow,
        board=board_snapshot,
        work_items=work_items_snapshot,
        stage_gates=stage_gates_snapshot,
        artifacts=artifacts_snapshot,
        approval_actions=approval_actions,
        workflow_actions=workflow_actions,
        execution_logs=execution_logs_snapshot,
        evidence=evidence_payload,
    )
    evidence_payload["artifacts"] = write_evidence_artifacts(trace_dir, evidence_payload)
    emit_run_result(
        build_run_result_payload(
            workflow_id=workflow_id,
            final_state=final_state,
            timed_out=timed_out,
            poll_iterations=poll_iterations,
            scenario_name=scenario_name,
            approval_mode=approval_mode,
            provider_auth_mode=provider_auth_mode,
            verification_mode=verification_mode,
            workflow=latest_workflow,
            board=board_snapshot,
            work_items=work_items_snapshot,
            stage_gates=stage_gates_snapshot,
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
        evidence=evidence_payload,
        execution_environment=selected_execution_environment,
        capability_proof=capability_proof,
    )
    )
    if not verification["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
