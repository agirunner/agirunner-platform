#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk09 import *


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

__all__ = [name for name in globals() if not name.startswith("__")]
