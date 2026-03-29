#!/usr/bin/env python3
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from live_test_api import ApiClient


FINAL_DELIVERABLE_STATUSES = {"approved", "completed", "final"}
PACKET_DESCRIPTOR_KINDS = {"brief_packet", "handoff_packet"}


def build_workspace_scope_trace(
    client: ApiClient,
    *,
    workflow_id: str,
    workflow: dict[str, Any],
    db_state: dict[str, Any] | None,
) -> dict[str, Any]:
    db_payload = db_state if isinstance(db_state, dict) else {}
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
            scope_key="workflow_scope",
            scope_kind="workflow",
            work_item_id=None,
            task_id=None,
        ),
        "selected_work_item_scope": reconcile_scope(
            client,
            workflow_id=workflow_id,
            db_state=db_payload,
            scope_key="selected_work_item_scope",
            scope_kind="selected_work_item",
            work_item_id=selected_work_item_id,
            task_id=None,
        ),
        "selected_task_scope": reconcile_scope(
            client,
            workflow_id=workflow_id,
            db_state=db_payload,
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
            + len(task_scope["update_ids"])
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
    failures = compare_scope_summary(
        api_summary=api_summary,
        db_summary=db_summary,
        scope_key=scope_key,
        scope_kind=scope_kind,
        work_item_id=work_item_id,
        task_id=task_id,
    )
    return {
        "scope_kind": scope_kind,
        "selection": {"work_item_id": work_item_id, "task_id": task_id},
        "workspace_api": api_summary,
        "db": db_summary,
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
        f"/api/v1/workflows/{workflow_id}/workspace?{urlencode(query)}",
        expected=(200,),
        label=f"workflows.workspace:{scope_kind}",
    )
    packet = first["data"]
    live_console = packet.get("live_console", {})
    deliverables = packet.get("deliverables", {})
    while isinstance(live_console, dict) and read_string(live_console.get("next_cursor")) is not None:
        next_packet = client.request(
            "GET",
            f"/api/v1/workflows/{workflow_id}/workspace?{urlencode({**query, 'live_console_after': live_console['next_cursor'], 'deliverables_limit': '1'})}",
            expected=(200,),
            label=f"workflows.workspace:{scope_kind}:live_console",
        )["data"]
        packet["live_console"]["items"].extend(next_packet.get("live_console", {}).get("items", []))
        packet["live_console"]["next_cursor"] = next_packet.get("live_console", {}).get("next_cursor")
        live_console = packet.get("live_console", {})
    while isinstance(deliverables, dict) and read_string(deliverables.get("next_cursor")) is not None:
        next_packet = client.request(
            "GET",
            f"/api/v1/workflows/{workflow_id}/workspace?{urlencode({**query, 'deliverables_after': deliverables['next_cursor'], 'live_console_limit': '1'})}",
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
    return {
        "selected_scope": packet.get("selected_scope", {}),
        "live_console": {
            "item_kind_counts": count_by_key(live_console_items, "item_kind"),
            "tracked_item_kind_counts": tracked_live_console_counts(live_console_items),
            "brief_ids": sorted(read_ids(live_console_items, kind="milestone_brief")),
            "update_ids": sorted(read_ids(live_console_items, kinds={"operator_update", "platform_notice"})),
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
    updates = filter_console_records(as_list(db_state.get("operator_updates")), scope_kind, work_item_id, task_id)
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
        "update_ids": sorted(read_ids(updates)),
        "update_item_kind_counts": {
            "milestone_brief": len(read_ids(briefs)),
            **count_update_item_kinds(updates),
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
    compare_id_family(failures, scope_key, "live console update ids", api_summary["live_console"]["update_ids"], db_summary["update_ids"])
    compare_counts(
        failures,
        scope_key,
        "live console payload families",
        api_summary["live_console"]["tracked_item_kind_counts"],
        db_summary["update_item_kind_counts"],
    )
    compare_id_family(failures, scope_key, "deliverable descriptor ids", api_summary["deliverables"]["all_descriptor_ids"], db_summary["all_descriptor_ids"])
    compare_id_family(failures, scope_key, "deliverable final ids", api_summary["deliverables"]["final_descriptor_ids"], db_summary["final_descriptor_ids"])
    compare_id_family(failures, scope_key, "deliverable in-progress ids", api_summary["deliverables"]["in_progress_descriptor_ids"], db_summary["in_progress_descriptor_ids"])
    compare_id_family(failures, scope_key, "deliverable brief packet ids", api_summary["deliverables"]["brief_packet_ids"], db_summary["brief_packet_ids"])
    compare_id_family(failures, scope_key, "deliverable handoff packet ids", api_summary["deliverables"]["handoff_packet_ids"], db_summary["handoff_packet_ids"])
    compare_id_family(failures, scope_key, "deliverable working handoff brief ids", api_summary["deliverables"]["working_handoff_brief_ids"], db_summary["deliverable_context_brief_ids"])
    compare_counts(failures, scope_key, "deliverable payload families", api_summary["deliverables"]["descriptor_kind_counts"], db_summary["deliverable_descriptor_kind_counts"])
    return failures


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


def count_update_item_kinds(updates: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in updates:
        update_kind = read_string(record.get("update_kind"))
        key = "platform_notice" if update_kind == "platform_notice" else "operator_update"
        counts[key] = counts.get(key, 0) + 1
    return counts


def tracked_live_console_counts(records: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        item_kind = read_string(record.get("item_kind"))
        if item_kind not in {"milestone_brief", "operator_update", "platform_notice"}:
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


def read_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def read_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]
