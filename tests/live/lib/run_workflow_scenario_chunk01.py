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

__all__ = [name for name in globals() if not name.startswith("__")]
