#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from live_test_api import ApiClient


FINAL_DELIVERABLE_STATUSES = {"approved", "completed", "final"}
PACKET_DESCRIPTOR_KINDS = {"brief_packet", "handoff_packet"}
ENHANCED_LOOP_PHASE_OPERATIONS = {
    "agent.think": "think",
    "agent.plan": "plan",
    "agent.act": "act",
    "agent.observe": "observe",
    "agent.verify": "verify",
}
SUPPRESSED_READ_ONLY_ACTION_TOOLS = {
    "artifact_list",
    "artifact_read",
    "artifact_document_read",
    "file_read",
    "file_list",
    "grep",
    "list_work_items",
    "list_workflow_tasks",
    "memory_read",
    "read_latest_handoff",
    "read_predecessor_handoff",
    "read_task_events",
    "read_task_output",
    "read_task_status",
    "read_stage_status",
    "read_work_item_continuity",
}
TOOL_SPECIFIC_FALLBACK_ONLY_ACTIONS = {
    "artifact_document_read",
    "artifact_read",
    "artifact_upload",
    "file_edit",
    "file_list",
    "file_read",
    "file_write",
}
LITERAL_ACTION_FALLBACK_ACTIONS = {"shell_exec"}
FORBIDDEN_SURFACED_FRAGMENTS = (
    "to=record_operator_update",
    "to=record_operator_brief",
    "{\"approach\":",
    "\"approach\":",
    "{\"request_id\":",
    "\"request_id\":",
)

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPOSE_EXECUTION_TURN_ROWS_SCRIPT = (
    REPO_ROOT / "tests" / "live" / "scripts" / "compose-execution-turn-rows.ts"
)


def build_workspace_scope_trace(
    client: ApiClient,
    *,
    workflow_id: str,
    workflow: dict[str, Any],
    db_state: dict[str, Any] | None,
    execution_logs: dict[str, Any] | None,
) -> dict[str, Any]:
    db_payload = db_state if isinstance(db_state, dict) else {}
    effective_mode = read_effective_live_visibility_mode(db_payload)
    composed_execution_turn_rows = load_composed_execution_turn_rows(execution_logs)
    candidate = select_scope_candidate(workflow, db_payload)
    if candidate is None:
        failure = "unable to select a non-orchestrator task with a work item for workspace scope reconciliation"
        return {"ok": False, "failures": [failure]}

    selected_work_item_id = candidate["work_item_id"]
    selected_task_id = candidate["task_id"]
    scopes = {
        "workflow_scope": reconcile_scope(
            client,
            workflow_id=workflow_id,
            db_state=db_payload,
            execution_logs=execution_logs,
            composed_execution_turn_rows=composed_execution_turn_rows,
            effective_mode=effective_mode,
            scope_key="workflow_scope",
            scope_kind="workflow",
            work_item_id=None,
            task_id=None,
        ),
        "selected_work_item_scope": reconcile_scope(
            client,
            workflow_id=workflow_id,
            db_state=db_payload,
            execution_logs=execution_logs,
            composed_execution_turn_rows=composed_execution_turn_rows,
            effective_mode=effective_mode,
            scope_key="selected_work_item_scope",
            scope_kind="selected_work_item",
            work_item_id=selected_work_item_id,
            task_id=None,
        ),
        "selected_task_scope": reconcile_scope(
            client,
            workflow_id=workflow_id,
            db_state=db_payload,
            execution_logs=execution_logs,
            composed_execution_turn_rows=composed_execution_turn_rows,
            effective_mode=effective_mode,
            scope_key="selected_task_scope",
            scope_kind="selected_task",
            work_item_id=selected_work_item_id,
            task_id=selected_task_id,
        ),
    }
    failures: list[str] = []
    for scope_key, scope in scopes.items():
        failures.extend([f"{scope_key}: {failure}" for failure in scope["reconciliation"]["failures"]])

    return {
        "ok": len(failures) == 0,
        "failures": failures,
        "effective_live_visibility_mode": effective_mode,
        "selected_work_item_id": selected_work_item_id,
        "selected_task_id": selected_task_id,
        **scopes,
    }


def select_scope_candidate(workflow: dict[str, Any], db_state: dict[str, Any]) -> dict[str, str] | None:
    tasks = [task for task in workflow.get("tasks", []) if isinstance(task, dict)]
    candidates: list[dict[str, Any]] = []
    for task in tasks:
        if bool(task.get("is_orchestrator_task")):
            continue
        task_id = read_string(task.get("id"))
        work_item_id = read_string(task.get("work_item_id"))
        if task_id is None or work_item_id is None:
            continue
        task_scope = summarize_db_scope(
            db_state,
            scope_kind="selected_task",
            work_item_id=work_item_id,
            task_id=task_id,
        )
        work_item_scope = summarize_db_scope(
            db_state,
            scope_kind="selected_work_item",
            work_item_id=work_item_id,
            task_id=None,
        )
        score = (
            len(task_scope["brief_ids"])
            + len(work_item_scope["all_descriptor_ids"])
            + len(work_item_scope["deliverable_context_brief_ids"])
        )
        candidates.append({"task_id": task_id, "work_item_id": work_item_id, "score": score})
    if not candidates:
        return None
    candidates.sort(key=lambda candidate: (-candidate["score"], candidate["task_id"]))
    return {"task_id": candidates[0]["task_id"], "work_item_id": candidates[0]["work_item_id"]}


def reconcile_scope(
    client: ApiClient,
    *,
    workflow_id: str,
    db_state: dict[str, Any],
    execution_logs: dict[str, Any] | None,
    composed_execution_turn_rows: list[dict[str, Any]] | None,
    effective_mode: str,
    scope_key: str,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> dict[str, Any]:
    packet = fetch_workspace_scope_packet(
        client,
        workflow_id=workflow_id,
        scope_kind=scope_kind,
        work_item_id=work_item_id,
        task_id=task_id,
    )
    api_summary = summarize_workspace_packet(packet)
    db_summary = summarize_db_scope(
        db_state,
        scope_kind=scope_kind,
        work_item_id=work_item_id,
        task_id=task_id,
    )
    enhanced_live_console = reconcile_enhanced_live_console(
        execution_logs=execution_logs,
        composed_execution_turn_rows=composed_execution_turn_rows,
        execution_turn_items=api_summary["live_console"]["execution_turn_items"],
        effective_mode=effective_mode,
        scope_kind=scope_kind,
        work_item_id=work_item_id,
        task_id=task_id,
    )
    failures = compare_scope_summary(
        api_summary=api_summary,
        db_summary=db_summary,
        effective_mode=effective_mode,
        scope_key=scope_key,
        scope_kind=scope_kind,
        work_item_id=work_item_id,
        task_id=task_id,
    )
    failures.extend(enhanced_live_console["failures"])
    return {
        "scope_kind": scope_kind,
        "selection": {"work_item_id": work_item_id, "task_id": task_id},
        "workspace_api": api_summary,
        "db": db_summary,
        "enhanced_live_console": enhanced_live_console,
        "reconciliation": {"passed": len(failures) == 0, "failures": failures},
    }


def fetch_workspace_scope_packet(
    client: ApiClient,
    *,
    workflow_id: str,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> dict[str, Any]:
    query = {"tab_scope": scope_kind, "live_console_limit": "200", "deliverables_limit": "200"}
    if work_item_id is not None:
        query["work_item_id"] = work_item_id
    if task_id is not None:
        query["task_id"] = task_id

    first = client.request(
        "GET",
        f"/api/v1/operations/workflows/{workflow_id}/workspace?{urlencode(query)}",
        expected=(200,),
        label=f"workflows.workspace:{scope_kind}",
    )
    packet = first["data"]
    live_console = packet.get("live_console", {})
    deliverables = packet.get("deliverables", {})
    while isinstance(live_console, dict) and read_string(live_console.get("next_cursor")) is not None:
        next_packet = client.request(
            "GET",
            f"/api/v1/operations/workflows/{workflow_id}/workspace?{urlencode({**query, 'live_console_after': live_console['next_cursor'], 'deliverables_limit': '1'})}",
            expected=(200,),
            label=f"workflows.workspace:{scope_kind}:live_console",
        )["data"]
        packet["live_console"]["items"].extend(next_packet.get("live_console", {}).get("items", []))
        packet["live_console"]["next_cursor"] = next_packet.get("live_console", {}).get("next_cursor")
        live_console = packet.get("live_console", {})
    while isinstance(deliverables, dict) and read_string(deliverables.get("next_cursor")) is not None:
        next_packet = client.request(
            "GET",
            f"/api/v1/operations/workflows/{workflow_id}/workspace?{urlencode({**query, 'deliverables_after': deliverables['next_cursor'], 'live_console_limit': '1'})}",
            expected=(200,),
            label=f"workflows.workspace:{scope_kind}:deliverables",
        )["data"]
        next_deliverables = next_packet.get("deliverables", {})
        packet["deliverables"]["final_deliverables"].extend(next_deliverables.get("final_deliverables", []))
        packet["deliverables"]["in_progress_deliverables"].extend(next_deliverables.get("in_progress_deliverables", []))
        packet["deliverables"]["next_cursor"] = next_deliverables.get("next_cursor")
        deliverables = packet.get("deliverables", {})
    return packet


def summarize_workspace_packet(packet: dict[str, Any]) -> dict[str, Any]:
    live_console_items = packet.get("live_console", {}).get("items", [])
    deliverables = packet.get("deliverables", {})
    all_deliverables = [
        *as_list(deliverables.get("final_deliverables")),
        *as_list(deliverables.get("in_progress_deliverables")),
    ]
    execution_turn_items = summarize_execution_turn_items(live_console_items)
    return {
        "selected_scope": packet.get("selected_scope", {}),
        "live_console": {
            "item_kind_counts": count_by_key(live_console_items, "item_kind"),
            "tracked_item_kind_counts": tracked_live_console_counts(live_console_items),
            "brief_ids": sorted(read_ids(live_console_items, kind="milestone_brief")),
            "execution_turn_ids": sorted(
                item["log_id"]
                for item in execution_turn_items
                if read_string(item.get("log_id")) is not None
            ),
            "execution_turn_items": execution_turn_items,
        },
        "deliverables": {
            "descriptor_kind_counts": count_by_key(all_deliverables, "descriptor_kind"),
            "final_descriptor_ids": sorted(read_descriptor_ids(as_list(deliverables.get("final_deliverables")))),
            "in_progress_descriptor_ids": sorted(read_descriptor_ids(as_list(deliverables.get("in_progress_deliverables")))),
            "all_descriptor_ids": sorted(read_descriptor_ids(all_deliverables)),
            "brief_packet_ids": sorted(read_descriptor_ids(all_deliverables, descriptor_kind="brief_packet")),
            "handoff_packet_ids": sorted(read_descriptor_ids(all_deliverables, descriptor_kind="handoff_packet")),
            "working_handoff_brief_ids": sorted(read_ids(as_list(deliverables.get("working_handoffs")))),
        },
    }


def summarize_db_scope(
    db_state: dict[str, Any],
    *,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> dict[str, Any]:
    briefs = filter_console_records(as_list(db_state.get("operator_briefs")), scope_kind, work_item_id, task_id)
    deliverables = filter_deliverable_records(as_list(db_state.get("deliverables")), scope_kind, work_item_id)
    deliverable_briefs = filter_deliverable_records(as_list(db_state.get("operator_briefs")), scope_kind, work_item_id)
    handoffs = filter_deliverable_records(as_list(db_state.get("completed_handoffs")), scope_kind, work_item_id)

    stored_final_packet_scopes = {
        scope_key(record.get("work_item_id"))
        for record in deliverables
        if is_packet_descriptor(record) and is_stored_final_deliverable(record)
    }
    stored_packet_scopes = {
        scope_key(record.get("work_item_id"))
        for record in deliverables
        if is_packet_descriptor(record)
    }
    stored_final_work_item_ids = {
        read_string(record.get("work_item_id"))
        for record in deliverables
        if is_stored_final_deliverable(record)
    }
    stored_final_work_item_ids.discard(None)
    existing_brief_ids = {read_string(record.get("source_brief_id")) for record in deliverables}
    existing_brief_ids.discard(None)

    deliverable_context_briefs = [
        brief for brief in deliverable_briefs if read_string(brief.get("brief_scope")) == "deliverable_context"
    ]
    finalizable_briefs = [
        brief for brief in deliverable_context_briefs if read_string(brief.get("status_kind")) in FINAL_DELIVERABLE_STATUSES
    ]
    brief_packet_ids: list[str] = []
    for brief in finalizable_briefs:
        brief_id = read_string(brief.get("id"))
        if brief_id is None or brief_id in existing_brief_ids:
            continue
        brief_scope_key = scope_key(brief.get("work_item_id"))
        orchestrator_brief = is_orchestrator_brief(brief)
        if brief_scope_key in stored_final_packet_scopes:
            continue
        if orchestrator_brief and brief_scope_key in stored_packet_scopes:
            continue
        if orchestrator_brief and read_string(brief.get("work_item_id")) is not None:
            continue
        brief_packet_ids.append(f"brief:{brief_id}")
        stored_final_packet_scopes.add(brief_scope_key)
        stored_packet_scopes.add(brief_scope_key)

    handoff_packet_ids: list[str] = []
    for handoff in handoffs:
        handoff_id = read_string(handoff.get("id"))
        handoff_work_item_id = read_string(handoff.get("work_item_id"))
        if handoff_id is None or handoff_work_item_id is None:
            continue
        if handoff_work_item_id in stored_final_work_item_ids:
            continue
        handoff_packet_ids.append(f"handoff:{handoff_id}")
        stored_final_work_item_ids.add(handoff_work_item_id)

    stored_deliverable_ids = sorted(read_descriptor_ids(deliverables))
    final_descriptor_ids = sorted(
        descriptor_id
        for descriptor_id in stored_deliverable_ids
        if any(
            read_string(record.get("descriptor_id")) == descriptor_id and is_final_deliverable(record, finalizable_briefs)
            for record in deliverables
        )
    )
    return {
        "brief_ids": sorted(read_ids(briefs)),
        "record_item_kind_counts": {
            "milestone_brief": len(read_ids(briefs)),
        },
        "deliverable_context_brief_ids": sorted(read_ids(deliverable_context_briefs)),
        "stored_descriptor_ids": stored_deliverable_ids,
        "stored_descriptor_kind_counts": count_by_key(deliverables, "descriptor_kind"),
        "brief_packet_ids": sorted(brief_packet_ids),
        "handoff_packet_ids": sorted(handoff_packet_ids),
        "all_descriptor_ids": sorted(stored_deliverable_ids + brief_packet_ids + handoff_packet_ids),
        "final_descriptor_ids": sorted(final_descriptor_ids + brief_packet_ids + handoff_packet_ids),
        "in_progress_descriptor_ids": sorted(
            descriptor_id for descriptor_id in stored_deliverable_ids if descriptor_id not in final_descriptor_ids
        ),
        "deliverable_descriptor_kind_counts": merge_counts(
            count_by_key(deliverables, "descriptor_kind"),
            {"brief_packet": len(brief_packet_ids), "handoff_packet": len(handoff_packet_ids)},
        ),
    }


def compare_scope_summary(
    *,
    api_summary: dict[str, Any],
    db_summary: dict[str, Any],
    effective_mode: str,
    scope_key: str,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> list[str]:
    failures: list[str] = []
    selected_scope = api_summary.get("selected_scope", {})
    if selected_scope.get("scope_kind") != scope_kind:
        failures.append(f"{scope_key} selected scope kind mismatch")
    if selected_scope.get("work_item_id") != work_item_id:
        failures.append(f"{scope_key} selected work item mismatch")
    if selected_scope.get("task_id") != task_id:
        failures.append(f"{scope_key} selected task mismatch")

    compare_id_family(failures, scope_key, "live console brief ids", api_summary["live_console"]["brief_ids"], db_summary["brief_ids"])
    compare_counts(
        failures,
        scope_key,
        "live console payload families",
        api_summary["live_console"]["tracked_item_kind_counts"],
        db_summary["record_item_kind_counts"],
    )
    compare_id_family(failures, scope_key, "deliverable descriptor ids", api_summary["deliverables"]["all_descriptor_ids"], db_summary["all_descriptor_ids"])
    compare_id_family(failures, scope_key, "deliverable final ids", api_summary["deliverables"]["final_descriptor_ids"], db_summary["final_descriptor_ids"])
    compare_id_family(failures, scope_key, "deliverable in-progress ids", api_summary["deliverables"]["in_progress_descriptor_ids"], db_summary["in_progress_descriptor_ids"])
    compare_id_family(failures, scope_key, "deliverable brief packet ids", api_summary["deliverables"]["brief_packet_ids"], db_summary["brief_packet_ids"])
    compare_id_family(failures, scope_key, "deliverable handoff packet ids", api_summary["deliverables"]["handoff_packet_ids"], db_summary["handoff_packet_ids"])
    compare_id_family(failures, scope_key, "deliverable working handoff brief ids", api_summary["deliverables"]["working_handoff_brief_ids"], db_summary["deliverable_context_brief_ids"])
    compare_counts(failures, scope_key, "deliverable payload families", api_summary["deliverables"]["descriptor_kind_counts"], db_summary["deliverable_descriptor_kind_counts"])
    return failures


def reconcile_enhanced_live_console(
    *,
    execution_logs: dict[str, Any] | None,
    composed_execution_turn_rows: list[dict[str, Any]] | None = None,
    execution_turn_items: list[dict[str, Any]],
    effective_mode: str,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> dict[str, Any]:
    actual_rows = [dict(item) for item in execution_turn_items if isinstance(item, dict)]
    mode = effective_mode if effective_mode in {"standard", "enhanced"} else "unknown"
    if mode != "enhanced":
        return {
            "applicable": False,
            "effective_mode": mode,
            "expected_rows": [],
            "actual_rows": actual_rows,
            "passed": True,
            "failures": [],
        }

    expected_rows = expected_enhanced_live_console_rows(
        execution_logs=execution_logs,
        composed_execution_turn_rows=composed_execution_turn_rows,
        scope_kind=scope_kind,
        work_item_id=work_item_id,
        task_id=task_id,
    )
    expected_by_id = {
        row["log_id"]: row
        for row in expected_rows
        if read_string(row.get("log_id")) is not None
    }
    actual_by_id = {
        row["log_id"]: row
        for row in actual_rows
        if read_string(row.get("log_id")) is not None
    }
    failures: list[str] = []

    for expected in expected_rows:
        log_id = read_string(expected.get("log_id"))
        if log_id is None or expected.get("surface_expected") is not True:
            continue
        actual = actual_by_id.get(log_id)
        if actual is None:
            failures.append(f"missing expected enhanced turn line execution-log:{log_id}")
            continue
        mismatch = compare_enhanced_live_console_row(expected=expected, actual=actual)
        if mismatch is not None:
            failures.append(f"execution-log:{log_id} {mismatch}")

    for actual in actual_rows:
        log_id = read_string(actual.get("log_id"))
        if log_id is None:
            failures.append("execution_turn item is missing execution-log linkage")
            continue
        expected = expected_by_id.get(log_id)
        if expected is None:
            failures.append(f"execution-log:{log_id} surfaced unexpectedly without a raw loop-phase source")
            continue
        if expected.get("surface_expected") is not True:
            reason = read_string(expected.get("suppression_reason")) or "suppressed"
            failures.append(f"execution-log:{log_id} surfaced unexpectedly for suppressed loop component ({reason})")
        forbidden_fragment = find_forbidden_live_console_fragment(actual)
        if forbidden_fragment is not None:
            failures.append(
                f"execution-log:{log_id} surfaced forbidden live-console fragment {forbidden_fragment!r}"
            )

    return {
        "applicable": True,
        "effective_mode": mode,
        "expected_rows": expected_rows,
        "actual_rows": actual_rows,
        "passed": len(failures) == 0,
        "failures": failures,
    }


def expected_enhanced_live_console_rows(
    *,
    execution_logs: dict[str, Any] | None,
    composed_execution_turn_rows: list[dict[str, Any]] | None,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> list[dict[str, Any]]:
    if composed_execution_turn_rows is not None:
        rows: list[dict[str, Any]] = []
        for row in composed_execution_turn_rows:
            normalized = normalize_composed_execution_turn_row(row)
            if enhanced_row_matches_scope(
                normalized,
                scope_kind=scope_kind,
                work_item_id=work_item_id,
                task_id=task_id,
            ):
                rows.append(normalized)
        return rows

    rows: list[dict[str, Any]] = []
    for row in execution_log_rows(execution_logs):
        normalized = compose_expected_execution_turn_row(row)
        if normalized is None or not enhanced_row_matches_scope(
            normalized,
            scope_kind=scope_kind,
            work_item_id=work_item_id,
            task_id=task_id,
        ):
            continue
        if should_suppress_adjacent_expected_row(rows[-1] if rows else None, normalized):
            continue
        rows.append(normalized)
    return rows


def summarize_execution_turn_items(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for record in records:
        if read_string(record.get("item_kind")) != "execution_turn":
            continue
        item_id = read_string(record.get("item_id"))
        items.append(
            {
                "log_id": read_execution_log_id(item_id),
                "item_id": item_id,
                "headline": read_string(record.get("headline")),
                "summary": read_string(record.get("summary")),
                "task_id": read_string(record.get("task_id")),
                "work_item_id": read_string(record.get("work_item_id")),
            }
        )
    return items


def load_composed_execution_turn_rows(execution_logs: dict[str, Any] | None) -> list[dict[str, Any]] | None:
    if not isinstance(execution_logs, dict):
        return None

    precomposed = execution_logs.get("composed_execution_turn_rows")
    if isinstance(precomposed, list):
        return [dict(item) for item in precomposed if isinstance(item, dict)]

    raw_rows = execution_log_rows(execution_logs)
    if len(raw_rows) == 0:
        return []

    if not COMPOSE_EXECUTION_TURN_ROWS_SCRIPT.is_file():
        return None

    try:
        result = subprocess.run(
            [
                "corepack",
                "pnpm",
                "exec",
                "tsx",
                str(COMPOSE_EXECUTION_TURN_ROWS_SCRIPT),
            ],
            cwd=REPO_ROOT,
            input=json.dumps({"rows": raw_rows}),
            text=True,
            capture_output=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    items = payload.get("items")
    if not isinstance(items, list):
        return None
    return [dict(item) for item in items if isinstance(item, dict)]


def normalize_composed_execution_turn_row(row: dict[str, Any]) -> dict[str, Any]:
    linked_target_ids = [
        value
        for value in as_list(row.get("linked_target_ids"))
        if isinstance(value, str) and value.strip() != ""
    ]
    return {
        "log_id": read_string(row.get("log_id")),
        "item_id": read_string(row.get("item_id")),
        "headline": read_string(row.get("headline")),
        "summary": read_string(row.get("summary")),
        "task_id": read_string(row.get("task_id")),
        "work_item_id": read_string(row.get("work_item_id")),
        "scope_binding": read_string(row.get("scope_binding")),
        "linked_target_ids": linked_target_ids,
        "surface_expected": True,
        "surface_kind": "execution_turn",
        "expected_headline": read_string(row.get("headline")),
        "expected_summary": read_string(row.get("summary")),
        "tool_name": None,
        "suppression_reason": None,
    }


def compose_expected_execution_turn_row(row: dict[str, Any]) -> dict[str, Any] | None:
    operation = read_string(row.get("operation"))
    if operation not in ENHANCED_LOOP_PHASE_OPERATIONS:
        return None
    payload = as_record(row.get("payload"))
    phase = read_string(payload.get("phase")) or ENHANCED_LOOP_PHASE_OPERATIONS[operation]
    scope = resolve_expected_execution_turn_scope(row, payload)
    headline = build_expected_execution_turn_headline(operation, payload)
    summary = build_expected_execution_turn_summary(operation, payload)
    base = {
        "log_id": read_string(row.get("id")),
        "operation": operation,
        "phase": phase,
        "phase_label": read_phase_label(operation),
        "task_id": scope["task_id"],
        "work_item_id": scope["work_item_id"],
        "scope_binding": scope["scope_binding"],
        "linked_target_ids": scope["linked_target_ids"],
        "surface_expected": False,
        "surface_kind": "execution_turn",
        "expected_headline": None,
        "expected_summary": None,
        "tool_name": None,
        "suppression_reason": None,
    }
    if not should_render_expected_execution_turn(operation, payload, headline):
        return {**base, "suppression_reason": read_suppression_reason(operation, payload, headline)}
    if headline is None:
        return None
    return {
        **base,
        "surface_expected": True,
        "expected_headline": headline,
        "expected_summary": summary,
        "tool_name": read_action_name(payload),
    }


def enhanced_row_matches_scope(
    row: dict[str, Any],
    *,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> bool:
    if scope_kind == "workflow":
        return True
    if scope_kind == "selected_task":
        return read_string(row.get("task_id")) == task_id
    return read_string(row.get("work_item_id")) == work_item_id


def compare_enhanced_live_console_row(
    *,
    expected: dict[str, Any],
    actual: dict[str, Any],
) -> str | None:
    expected_task_id = read_string(expected.get("task_id"))
    actual_task_id = read_string(actual.get("task_id"))
    if expected_task_id != actual_task_id:
        return "task scope mismatch"
    expected_work_item_id = read_string(expected.get("work_item_id"))
    actual_work_item_id = read_string(actual.get("work_item_id"))
    if expected_work_item_id != actual_work_item_id:
        return "work item scope mismatch"

    headline = normalized_text(actual.get("headline"))
    if headline is None:
        return "headline is missing"
    expected_headline = normalized_text(expected.get("expected_headline"))
    if expected_headline is None:
        return None
    if not preview_matches(actual=headline, expected=expected_headline):
        return "headline did not match the canonical execution-turn headline"
    return None


def should_render_expected_execution_turn(
    operation: str,
    payload: dict[str, Any],
    headline: str | None,
) -> bool:
    if operation == "agent.think":
        return read_think_text(payload) is not None
    if operation == "agent.plan":
        return read_plan_text(payload) is not None
    if operation == "agent.act":
        action_name = read_action_name(payload)
        if is_suppressed_action_name(action_name) or is_low_value_helper_action(action_name):
            return False
        return read_act_text(payload, headline) is not None or headline is not None
    if operation == "agent.observe":
        return read_observe_text(payload) is not None
    if operation == "agent.verify":
        return is_meaningful_verify(payload)
    return headline is not None


def read_suppression_reason(
    operation: str,
    payload: dict[str, Any],
    headline: str | None,
) -> str:
    if operation == "agent.act":
        action_name = read_action_name(payload)
        if is_suppressed_action_name(action_name):
            return "internal_operator_record"
        if is_low_value_helper_action(action_name):
            return "low_value_helper_action"
        if read_act_text(payload, headline) is None and headline is None:
            return "missing_operator_meaningful_action_text"
    return "suppressed"


def build_expected_execution_turn_headline(
    operation: str,
    payload: dict[str, Any],
) -> str | None:
    if operation == "agent.think":
        detail = read_think_text(payload)
    elif operation == "agent.plan":
        detail = read_plan_text(payload)
    elif operation == "agent.act":
        action_headline = build_action_headline(payload)
        detail = read_act_text(payload, action_headline) or action_headline
    elif operation == "agent.observe":
        detail = read_observe_text(payload)
    elif operation == "agent.verify":
        detail = read_verify_text(payload) or read_operator_readable_text(build_verify_headline(payload), 180)
    else:
        detail = None
    if detail is None:
        return None
    return format_execution_phase_headline(operation, detail)


def build_expected_execution_turn_summary(
    operation: str,
    payload: dict[str, Any],
) -> str | None:
    return (
        read_act_summary(payload)
        or read_plan_text(payload)
        or read_think_text(payload)
        or read_observe_text(payload)
        or read_verify_text(payload)
        or read_operator_readable_field(payload, ["summary", "details", "reasoning_summary", "approach"])
        or build_execution_turn_fallback_summary(operation)
    )


def resolve_expected_execution_turn_scope(
    row: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    targets = extract_structured_target_ids(as_record(payload.get("input")))
    if not targets["work_item_ids"] and not targets["task_ids"]:
        linked_target_ids = dedupe_ids(
            [
                read_string(row.get("workflow_id")),
                read_string(row.get("work_item_id")),
                read_string(row.get("task_id")),
            ]
        )
        return {
            "scope_binding": "execution_context",
            "work_item_id": read_string(row.get("work_item_id")),
            "task_id": read_string(row.get("task_id")),
            "linked_target_ids": linked_target_ids,
        }
    return {
        "scope_binding": "structured_target",
        "work_item_id": targets["work_item_ids"][0] if targets["work_item_ids"] else None,
        "task_id": targets["task_ids"][0] if targets["task_ids"] else None,
        "linked_target_ids": dedupe_ids(
            [read_string(row.get("workflow_id")), *targets["work_item_ids"], *targets["task_ids"]]
        ),
    }


def extract_structured_target_ids(input_payload: dict[str, Any]) -> dict[str, list[str]]:
    work_item_ids: set[str] = set()
    task_ids: set[str] = set()
    collect_structured_target_ids(input_payload, work_item_ids, task_ids)
    return {
        "work_item_ids": sorted(work_item_ids),
        "task_ids": sorted(task_ids),
    }


def collect_structured_target_ids(value: Any, work_item_ids: set[str], task_ids: set[str]) -> None:
    if isinstance(value, list):
        for entry in value:
            collect_structured_target_ids(entry, work_item_ids, task_ids)
        return
    if not isinstance(value, dict):
        return

    record = as_record(value)
    for key, entry in record.items():
        if key == "target_id":
            target_type = read_string(record.get("target_type"))
            target_id = read_string(entry)
            if target_type == "work_item" and target_id is not None:
                work_item_ids.add(target_id)
            if target_type == "task" and target_id is not None:
                task_ids.add(target_id)
            continue
        if key == "work_item_id" or key.endswith("_work_item_id"):
            work_item_id = read_string(entry)
            if work_item_id is not None:
                work_item_ids.add(work_item_id)
            continue
        if key == "task_id" or key.endswith("_task_id"):
            task_id = read_string(entry)
            if task_id is not None:
                task_ids.add(task_id)
            continue
        collect_structured_target_ids(entry, work_item_ids, task_ids)


def dedupe_ids(values: list[str | None]) -> list[str]:
    ordered: list[str] = []
    for value in values:
        if value is None or value in ordered:
            continue
        ordered.append(value)
    return ordered


def build_action_headline(payload: dict[str, Any]) -> str | None:
    return build_humanized_action_headline(payload) or build_action_invocation_headline(payload)


def build_action_invocation_headline(payload: dict[str, Any]) -> str | None:
    action_name = read_action_name(payload)
    if action_name is None or not can_render_literal_action_fallback(action_name):
        return None
    args = summarize_action_args(action_name, as_record(payload.get("input")))
    if not args:
        return None
    return f"calling {action_name}({', '.join(args)})"


def build_humanized_action_headline(payload: dict[str, Any]) -> str | None:
    action_name = read_action_name(payload)
    input_payload = as_record(payload.get("input"))
    if action_name == "submit_handoff":
        summary = read_operator_readable_text(read_string(input_payload.get("summary")), 140)
        return f"Submitting the handoff: {summary}" if summary is not None else None
    if action_name == "artifact_upload":
        path = read_action_path(input_payload)
        return f"Uploading {path}." if path is not None else None
    if action_name == "create_task":
        title = read_operator_readable_text(read_string(input_payload.get("title")), 120)
        if title is not None:
            return f"Creating a task: {title}"
        role = read_humanized_string(input_payload.get("role"))
        return f"Creating a task for {role}." if role is not None else None
    return None


def build_verify_headline(payload: dict[str, Any]) -> str | None:
    status = read_string(payload.get("status"))
    decision = read_string(payload.get("decision"))
    if status is not None and decision is not None:
        return f"Verification {humanize_token(status)}: {humanize_token(decision)}"
    if status is not None:
        return f"Verification {humanize_token(status)}"
    if decision is not None:
        return f"Verification {humanize_token(decision)}"
    return None


def read_think_text(payload: dict[str, Any]) -> str | None:
    return read_operator_readable_field(payload, ["headline", "reasoning_summary", "approach"])


def read_plan_text(payload: dict[str, Any]) -> str | None:
    return read_operator_readable_field(payload, ["headline", "summary", "plan_summary"]) or read_operator_readable_text(
        read_first_plan_description(payload.get("steps")), 180
    )


def read_observe_text(payload: dict[str, Any]) -> str | None:
    return read_operator_readable_field(payload, ["headline", "summary", "details", "text_preview"])


def read_verify_text(payload: dict[str, Any]) -> str | None:
    return read_operator_readable_field(payload, ["headline", "summary", "details"])


def read_act_text(payload: dict[str, Any], action_headline: str | None) -> str | None:
    explicit_headline = read_operator_readable_field(payload, ["headline"])
    if explicit_headline is not None:
        return explicit_headline
    text_preview = read_operator_readable_field(payload, ["text_preview"])
    if text_preview is not None and not looks_like_synthetic_action_preview(text_preview, action_headline):
        return text_preview
    return None


def read_act_summary(payload: dict[str, Any]) -> str | None:
    return read_act_text(payload, None) or build_humanized_action_headline(payload) or build_action_invocation_headline(
        payload
    )


def is_meaningful_verify(payload: dict[str, Any]) -> bool:
    text = read_verify_text(payload)
    if text is None:
        return False
    status = read_string(payload.get("status"))
    decision = read_string(payload.get("decision"))
    if is_meaningful_verify_token(status) or is_meaningful_verify_token(decision):
        return True
    return bool(
        re.search(
            r"\b(blocked|waiting|wait|rework|request changes|approved|rejected|failed|complete|completed)\b",
            text,
        )
    )


def is_meaningful_verify_token(value: str | None) -> bool:
    if value is None:
        return False
    return bool(re.search(r"^(blocked|waiting|wait|rework|request_changes|approved|rejected|failed|complete|completed)$", value))


def summarize_action_args(action_name: str, input_payload: dict[str, Any]) -> list[str]:
    specialized_args = summarize_tool_specific_args(action_name, input_payload)
    if specialized_args:
        return specialized_args
    if action_name in TOOL_SPECIFIC_FALLBACK_ONLY_ACTIONS:
        return []

    preferred_keys = ["summary", "headline", "title", "role", "completion", "decision", "stage_name"]
    summaries: list[str] = []
    for key in preferred_keys:
        rendered = render_action_arg(key, input_payload.get(key))
        if rendered is not None:
            summaries.append(rendered)
        if len(summaries) >= 3:
            return summaries

    for key, value in input_payload.items():
        if key in preferred_keys or should_skip_action_arg(key, value):
            continue
        rendered = render_action_arg(key, value)
        if rendered is not None:
            summaries.append(rendered)
        if len(summaries) >= 3:
            break
    return summaries


def summarize_tool_specific_args(action_name: str, input_payload: dict[str, Any]) -> list[str]:
    if action_name == "file_read":
        path_range = format_path_range_summary(input_payload)
        return [f'path="{path_range.replace(chr(34), chr(39))}"'] if path_range is not None else []
    if action_name in TOOL_SPECIFIC_FALLBACK_ONLY_ACTIONS:
        path_like = (
            sanitize_path_like_arg(read_string(input_payload.get("logical_path")))
            or sanitize_path_like_arg(read_string(input_payload.get("path")))
            or sanitize_path_like_arg(read_string(input_payload.get("artifact_name")))
        )
        return [f'path="{truncate(path_like, 72).replace(chr(34), chr(39))}"'] if path_like is not None else []
    return []


def format_path_range_summary(input_payload: dict[str, Any]) -> str | None:
    path = sanitize_path_like_arg(read_string(input_payload.get("path")))
    if path is None:
        return None
    if is_logical_context_label(path):
        return path
    offset = read_optional_number(input_payload.get("offset"))
    limit = read_optional_number(input_payload.get("limit"))
    if offset is None or limit is None:
        return truncate(path, 72)
    return truncate(f"{path}:{offset}-{offset + limit - 1}", 72)


def is_logical_context_label(value: str) -> bool:
    return value in {
        "activation checkpoint",
        "execution brief",
        "execution context",
        "orchestrator context",
        "predecessor handoff",
        "task context",
        "task input",
        "upstream context",
        "work item context",
        "workflow context",
        "workspace context",
        "workspace memory",
    }


def render_action_arg(key: str, value: Any) -> str | None:
    if should_skip_action_arg(key, value):
        return None
    if isinstance(value, str):
        normalized = normalize_action_arg_text(key, value)
        return f'{key}="{normalized}"' if normalized is not None else None
    if isinstance(value, (int, float, bool)):
        return f"{key}={value}"
    return None


def should_skip_action_arg(key: str, value: Any) -> bool:
    if key.strip() == "" or key == "cwd":
        return True
    if key == "request_id" or key.endswith("_id") or key.endswith("_ids") or key in {"id", "ids"}:
        return True
    return isinstance(value, (list, dict))


def normalize_action_arg_text(key: str, value: str) -> str | None:
    sanitized_path = sanitize_path_like_arg(value) if is_path_like_key(key) else None
    normalized = read_operator_readable_text(sanitized_path or value, 72)
    return normalized.replace('"', "'") if normalized is not None else None


def is_path_like_key(key: str) -> bool:
    return key == "path" or key == "logical_path" or key.endswith("_path")


def read_action_path(input_payload: dict[str, Any]) -> str | None:
    return (
        sanitize_path_like_arg(read_string(input_payload.get("logical_path")))
        or sanitize_path_like_arg(read_string(input_payload.get("path")))
        or sanitize_path_like_arg(read_string(input_payload.get("artifact_name")))
    )


def sanitize_path_like_arg(value: str | None) -> str | None:
    path = read_string(value)
    if path is None:
        return None
    context_label = describe_logical_context_path(path)
    if context_label is not None:
        return context_label
    if looks_like_suppressed_context_path(path):
        return None
    if path.startswith("/tmp/workspace/"):
        relative = extract_workspace_relative_path(path)
        relative_context_label = describe_logical_context_path(relative)
        if relative_context_label is not None:
            return relative_context_label
        if relative is None or looks_like_suppressed_context_path(relative):
            return None
        return relative
    if path.startswith("/"):
        return None
    if path.startswith("repo/"):
        return path[len("repo/") :]
    return path


def describe_logical_context_path(path: str | None) -> str | None:
    normalized = read_string(path)
    if normalized is None:
        return None
    filename = normalized.replace("\\", "/").split("/")[-1]
    labels = {
        "activation-checkpoint.json": "activation checkpoint",
        "activation-checkpoint.md": "activation checkpoint",
        "current-task.json": "task context",
        "current-task.md": "task context",
        "current-workflow.json": "workflow context",
        "current-workflow.md": "workflow context",
        "execution-brief.json": "execution brief",
        "execution-brief.md": "execution brief",
        "execution-context.json": "execution context",
        "execution-context.md": "execution context",
        "orchestrator-context.json": "orchestrator context",
        "orchestrator-context.md": "orchestrator context",
        "predecessor-handoff.json": "predecessor handoff",
        "predecessor-handoff.md": "predecessor handoff",
        "predecessor_handoff.json": "predecessor handoff",
        "task-context.json": "task context",
        "task-input.json": "task input",
        "task-input.md": "task input",
        "upstream-context.json": "upstream context",
        "upstream-context.md": "upstream context",
        "work-item.json": "work item context",
        "work-item.md": "work item context",
        "workflow-context.json": "workflow context",
        "workspace-context.json": "workspace context",
        "workspace-context.md": "workspace context",
        "workspace-memory.json": "workspace memory",
        "workspace-memory.md": "workspace memory",
    }
    return labels.get(filename)


def extract_workspace_relative_path(path: str) -> str | None:
    task_workspace_match = re.search(r"^/tmp/workspace/task-[^/]+/(.+)$", path)
    if task_workspace_match is not None:
        return normalize_workspace_relative_path(task_workspace_match.group(1))
    workspace_match = re.search(r"^/tmp/workspace/(.+)$", path)
    if workspace_match is not None:
        return normalize_workspace_relative_path(workspace_match.group(1))
    return None


def normalize_workspace_relative_path(relative_path: str) -> str | None:
    if relative_path == "":
        return None
    if relative_path.startswith("repo/"):
        return relative_path[len("repo/") :]
    if relative_path.startswith("workspace/"):
        return relative_path[len("workspace/") :]
    return relative_path


def looks_like_suppressed_context_path(path: str) -> bool:
    return (
        path == "context"
        or path.startswith("context/")
        or path == "/workspace/context"
        or path.startswith("/workspace/context/")
        or path == "workspace/context"
        or path.startswith("workspace/context/")
    )


def read_action_name(payload: dict[str, Any]) -> str | None:
    return (
        read_string(payload.get("mcp_tool_name"))
        or read_string(payload.get("tool"))
        or read_string(payload.get("action"))
        or read_string(payload.get("command"))
    )


def is_suppressed_action_name(action_name: str | None) -> bool:
    return action_name in {"record_operator_brief", "record_operator_update"}


def is_low_value_helper_action(action_name: str | None) -> bool:
    return action_name in SUPPRESSED_READ_ONLY_ACTION_TOOLS if action_name is not None else False


def can_render_literal_action_fallback(action_name: str) -> bool:
    if is_low_value_helper_action(action_name) or action_name in TOOL_SPECIFIC_FALLBACK_ONLY_ACTIONS:
        return False
    if action_name in LITERAL_ACTION_FALLBACK_ACTIONS:
        return True
    return bool(
        re.search(
            r"^(create|submit|update|write|edit|delete|approve|reject|reassign|assign|claim|start|complete|finish|close|open|upload|request|dispatch|resume|pause|retry|reroute|set|mark)_",
            action_name,
        )
    )


def read_first_plan_description(value: Any) -> str | None:
    if not isinstance(value, list):
        return None
    for entry in value:
        if not isinstance(entry, dict):
            continue
        description = read_string(entry.get("description"))
        if description is not None:
            return description
    return None


def read_operator_readable_field(payload: dict[str, Any], keys: list[str]) -> str | None:
    for key in keys:
        value = read_operator_readable_text(read_string(payload.get(key)), 180)
        if value is not None:
            return value
    return None


def read_operator_readable_text(value: str | None, max_length: int) -> str | None:
    normalized = normalize_console_text(value)
    trimmed = truncate(normalized, max_length)
    if trimmed is None or looks_like_raw_execution_dump(trimmed) or looks_like_low_value_console_text(trimmed):
        return None
    return trimmed


def normalize_console_text(value: str | None) -> str | None:
    parsed = read_string(value)
    if parsed is None:
        return None
    normalized = (
        parsed.replace("\u200b", " ")
        .replace("\u200c", " ")
        .replace("\u200d", " ")
        .replace("\u2060", " ")
        .replace("\ufeff", " ")
        .replace("\ufffd", " ")
        .replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
    )

    previous = None
    while normalized != previous:
        previous = normalized
        normalized = re.sub(r"^\s*(?:approach|plan|plan summary|summary|details)\s*:\s*", "", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"^\s*(?:operator\s+)?(?:brief|update)\s*:\s*", "", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"^\s*[•·▪◦●◆▶▷→*-]+\s*", "", normalized)
        normalized = normalized.strip()

    normalized = " ".join(normalized.split())
    return normalized if normalized else None


def looks_like_synthetic_action_preview(value: str, action_headline: str | None) -> bool:
    normalized = value.strip().lower()
    if normalized.startswith("calling "):
        return True
    if normalized == "tool execution in progress":
        return True
    return action_headline is not None and normalized == action_headline.lower()


def looks_like_low_value_console_text(value: str) -> bool:
    patterns = (
        r"^advancing the task with the next verified step\.?$",
        r"^working through the next execution step\.?$",
        r"^checking current progress\.?$",
        r"^burst_budget:",
        r"\brecord the .*?(milestone|terminal|closure|operator-visible).*?\b(brief|update)\b",
        r"\bemit the required .*?\b(brief|update)\b",
        r"\bsubmitt?(?:ing)? the required structured handoff\b",
        r"\bfinish this (?:heartbeat )?activation\b.*\bstructured handoff\b",
        r"\b(remains|still|continues to be|continues)\b.*\bready\b",
        r"\b(remains|still|continues to be|continues)\b.*\b(suitable|supports|cleared)\b",
    )
    return any(re.search(pattern, value, flags=re.IGNORECASE) for pattern in patterns)


def looks_like_raw_execution_dump(value: str) -> bool:
    return (
        "{" in value
        or "}" in value
        or "[" in value
        or "]" in value
        or bool(re.search(r"\brecord_operator_(brief|update)\b", value, flags=re.IGNORECASE))
        or bool(re.search(r"\boperator (brief|update)s?\b", value, flags=re.IGNORECASE))
        or bool(re.search(r"^executed\s+\d+\s+tools?", value, flags=re.IGNORECASE))
        or bool(re.search(r"^signal_mutation:", value, flags=re.IGNORECASE))
        or bool(re.search(r"^boundary_tool:", value, flags=re.IGNORECASE))
        or bool(re.search(r"\bphase\s+\w+", value, flags=re.IGNORECASE))
        or bool(re.search(r"\bturn\s+\d+\b", value, flags=re.IGNORECASE))
        or bool(re.search(r"\btool steps?\b", value, flags=re.IGNORECASE))
        or bool(re.search(r"\btool_failure\b", value, flags=re.IGNORECASE))
        or bool(re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", value, flags=re.IGNORECASE))
    )


def build_execution_turn_fallback_summary(operation: str) -> str:
    if operation in {"agent.observe", "agent.verify"}:
        return "Checked the latest execution results."
    return "Working through the next execution step."


def should_suppress_adjacent_expected_row(previous: dict[str, Any] | None, current: dict[str, Any]) -> bool:
    if previous is None:
        return False
    previous_summary = normalize_execution_comparison_text(read_string(previous.get("expected_summary")))
    current_summary = normalize_execution_comparison_text(read_string(current.get("expected_summary")))
    return previous_summary is not None and previous_summary == current_summary


def normalize_execution_comparison_text(value: str | None) -> str | None:
    return normalize_console_text(strip_execution_phase_prefix(value))


def strip_execution_phase_prefix(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"^\[[^\]]+\]\s*", "", value)


def format_execution_phase_headline(operation: str, headline: str) -> str:
    return f"[{read_phase_label(operation)}] {headline}"


def read_phase_label(operation: str) -> str:
    labels = {
        "agent.act": "Act",
        "agent.observe": "Observe",
        "agent.plan": "Plan",
        "agent.think": "Think",
        "agent.verify": "Verify",
    }
    return labels.get(operation, humanize_token(operation))


def humanize_token(value: str) -> str:
    return " ".join(piece.capitalize() for piece in re.split(r"[_-]+", value) if piece)


def read_humanized_string(value: Any) -> str | None:
    parsed = read_string(value)
    return humanize_token(parsed) if parsed is not None else None


def read_optional_number(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def truncate(value: str | None, max_length: int) -> str | None:
    if value is None:
        return None
    return value if len(value) <= max_length else f"{value[: max_length - 1]}…"


def as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def read_effective_live_visibility_mode(db_state: dict[str, Any]) -> str:
    workflow = db_state.get("workflow")
    if not isinstance(workflow, dict):
        return "unknown"
    mode = read_string(workflow.get("effective_live_visibility_mode"))
    return mode or "unknown"


def read_execution_log_id(item_id: str | None) -> str | None:
    if item_id is None or not item_id.startswith("execution-log:"):
        return None
    return read_string(item_id.removeprefix("execution-log:"))


def build_verify_preview(payload: dict[str, Any]) -> str | None:
    decision = read_string(payload.get("decision"))
    if decision is None or decision == "continue":
        return None
    return f"verify decision: {decision}"


def action_call_requires_arguments(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    for item in value.values():
        if isinstance(item, str) and item.strip() != "":
            return True
        if isinstance(item, (int, float, bool)):
            return True
        if isinstance(item, list) and len(item) > 0:
            return True
        if isinstance(item, dict) and len(item) > 0:
            return True
    return False


def find_forbidden_live_console_fragment(row: dict[str, Any]) -> str | None:
    for field_name in ("headline", "summary"):
        value = normalized_text(row.get(field_name))
        if value is None:
            continue
        lowered = value.lower()
        for fragment in FORBIDDEN_SURFACED_FRAGMENTS:
            if fragment in lowered:
                return fragment
    return None


def preview_matches(*, actual: str, expected: str) -> bool:
    normalized_actual = normalize_preview(actual)
    normalized_expected = normalize_preview(expected)
    if normalized_actual == normalized_expected:
        return True
    if normalized_actual.endswith("..."):
        return normalized_expected.startswith(normalized_actual[:-3])
    return normalized_expected.startswith(normalized_actual)


def normalize_preview(value: str) -> str:
    return value.replace("…", "...").strip()


def normalized_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = " ".join(value.split())
    return trimmed if trimmed else None


def compare_id_family(failures: list[str], scope_key: str, label: str, api_ids: list[str], db_ids: list[str]) -> None:
    if sorted(api_ids) != sorted(db_ids):
        failures.append(f"{scope_key} {label} mismatch")


def compare_counts(failures: list[str], scope_key: str, label: str, api_counts: dict[str, int], db_counts: dict[str, int]) -> None:
    normalized_api = {key: value for key, value in api_counts.items() if value > 0}
    normalized_db = {key: value for key, value in db_counts.items() if value > 0}
    if normalized_api != normalized_db:
        failures.append(f"{scope_key} {label} mismatch")


def filter_console_records(records: list[dict[str, Any]], scope_kind: str, work_item_id: str | None, task_id: str | None) -> list[dict[str, Any]]:
    if scope_kind == "workflow":
        return records
    if scope_kind == "selected_task":
        return [record for record in records if matches_task_scope(record, task_id)]
    return [record for record in records if matches_work_item_scope(record, work_item_id)]


def filter_deliverable_records(records: list[dict[str, Any]], scope_kind: str, work_item_id: str | None) -> list[dict[str, Any]]:
    if scope_kind == "workflow":
        return [record for record in records if read_string(record.get("work_item_id")) is None]
    return [
        record
        for record in records
        if read_string(record.get("work_item_id")) in {None, work_item_id}
    ]


def matches_task_scope(record: dict[str, Any], task_id: str | None) -> bool:
    if task_id is None:
        return False
    return read_string(record.get("task_id")) == task_id or task_id in read_string_list(record.get("linked_target_ids"))


def matches_work_item_scope(record: dict[str, Any], work_item_id: str | None) -> bool:
    if work_item_id is None:
        return False
    return read_string(record.get("work_item_id")) == work_item_id or work_item_id in read_string_list(record.get("linked_target_ids"))


def tracked_live_console_counts(records: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        item_kind = read_string(record.get("item_kind"))
        if item_kind != "milestone_brief":
            continue
        counts[item_kind] = counts.get(item_kind, 0) + 1
    return counts


def is_final_deliverable(record: dict[str, Any], finalizable_briefs: list[dict[str, Any]]) -> bool:
    if is_stored_final_deliverable(record):
        return True
    source_brief_id = read_string(record.get("source_brief_id"))
    if source_brief_id and any(read_string(brief.get("id")) == source_brief_id for brief in finalizable_briefs):
        return True
    descriptor_id = read_string(record.get("descriptor_id"))
    for brief in finalizable_briefs:
        if descriptor_id in read_string_list(brief.get("related_output_descriptor_ids")):
            return True
    return False


def is_stored_final_deliverable(record: dict[str, Any]) -> bool:
    return read_string(record.get("delivery_stage")) == "final" or read_string(record.get("state")) == "final"


def is_packet_descriptor(record: dict[str, Any]) -> bool:
    return read_string(record.get("descriptor_kind")) in PACKET_DESCRIPTOR_KINDS


def is_orchestrator_brief(record: dict[str, Any]) -> bool:
    source_kind = read_string(record.get("source_kind"))
    source_role_name = read_string(record.get("source_role_name"))
    return source_kind == "orchestrator" or (source_role_name or "").lower() == "orchestrator"


def count_by_key(records: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        value = read_string(record.get(key))
        if value is None:
            continue
        counts[value] = counts.get(value, 0) + 1
    return counts


def merge_counts(base: dict[str, int], extra: dict[str, int]) -> dict[str, int]:
    merged = dict(base)
    for key, value in extra.items():
        if value <= 0:
            continue
        merged[key] = merged.get(key, 0) + value
    return merged


def read_ids(records: list[dict[str, Any]], *, kind: str | None = None, kinds: set[str] | None = None) -> list[str]:
    ids: list[str] = []
    for record in records:
        item_kind = read_string(record.get("item_kind"))
        if kind is not None and item_kind != kind:
            continue
        if kinds is not None and item_kind not in kinds:
            continue
        value = read_string(record.get("id") or record.get("item_id"))
        if value is not None:
            ids.append(value)
    return ids


def read_descriptor_ids(records: list[dict[str, Any]], *, descriptor_kind: str | None = None) -> list[str]:
    ids: list[str] = []
    for record in records:
        if descriptor_kind is not None and read_string(record.get("descriptor_kind")) != descriptor_kind:
            continue
        value = read_string(record.get("descriptor_id") or record.get("id"))
        if value is not None:
            ids.append(value)
    return ids


def scope_key(value: Any) -> str:
    return read_string(value) or "__workflow__"


def as_list(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def execution_log_rows(logs: Any) -> list[dict[str, Any]]:
    if isinstance(logs, dict):
        data = logs.get("data")
        return as_list(data)
    return as_list(logs)


def read_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def read_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]
