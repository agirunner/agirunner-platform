#!/usr/bin/env python3
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from common import ensure_dir, write_json_file
from operator_flow import TERMINAL_WORKFLOW_STATES, submit_pending_operator_approvals, submit_ready_steering_requests
from run_playbook import build_workflow_launch_payload
from workspace_prep import build_workspace_create_input, prepare_workspace_materials


def summarize_workspace_packet(packet: dict[str, Any]) -> dict[str, Any]:
    deliverables = packet.get("deliverables")
    if not isinstance(deliverables, dict):
        deliverables = {}
    final_deliverables = deliverables.get("final_deliverables")
    in_progress_deliverables = deliverables.get("in_progress_deliverables")
    final_list = final_deliverables if isinstance(final_deliverables, list) else []
    in_progress_list = in_progress_deliverables if isinstance(in_progress_deliverables, list) else []
    descriptor_kind_counts: dict[str, int] = {}
    for item in [*final_list, *in_progress_list]:
        if not isinstance(item, dict):
            continue
        descriptor_kind = str(item.get("descriptor_kind") or "unknown").strip() or "unknown"
        descriptor_kind_counts[descriptor_kind] = descriptor_kind_counts.get(descriptor_kind, 0) + 1
    live_console = packet.get("live_console")
    live_console_total = 0
    if isinstance(live_console, dict):
        live_console_total = int(live_console.get("total_count") or 0)
    return {
        "live_console_total": live_console_total,
        "final_deliverable_count": len(final_list),
        "in_progress_deliverable_count": len(in_progress_list),
        "descriptor_kind_counts": descriptor_kind_counts,
    }


def default_timeout_seconds() -> int:
    return int(os.environ.get("COMMUNITY_PLAYBOOKS_TIMEOUT_SECONDS", "1800"))


def default_poll_interval_seconds() -> int:
    return int(os.environ.get("COMMUNITY_PLAYBOOKS_POLL_INTERVAL_SECONDS", "10"))


def _result_path(results_dir: Path, run_spec: dict[str, Any]) -> Path:
    return results_dir / str(run_spec["batch"]) / str(run_spec["playbook_slug"]) / f"{run_spec['variant']}.json"


def _has_observable_output(packet_summary: dict[str, Any], briefs: list[dict[str, Any]]) -> bool:
    return (
        packet_summary["final_deliverable_count"] > 0
        or packet_summary["in_progress_deliverable_count"] > 0
        or packet_summary["live_console_total"] > 0
        or len(briefs) > 0
    )


def _evaluate_result(
    *,
    run_spec: dict[str, Any],
    workflow: dict[str, Any],
    packet_summary: dict[str, Any],
    briefs: list[dict[str, Any]],
    approval_actions: list[dict[str, Any]],
    steering_actions: list[dict[str, Any]],
    timed_out: bool,
) -> list[str]:
    failures: list[str] = []
    final_state = str(workflow.get("state") or "").strip()
    if timed_out:
        failures.append("workflow did not reach a terminal state before the timeout")
    elif final_state != "completed":
        failures.append(f"workflow finished in unsupported state {final_state!r}")
    if not _has_observable_output(packet_summary, briefs):
        failures.append("workflow finished without observable output")
    expected_approvals = sum(
        1
        for action in list(run_spec.get("operator_actions") or [])
        if isinstance(action, dict) and str(action.get("kind") or "").strip() == "approval"
    )
    if expected_approvals > 0 and len(approval_actions) == 0:
        failures.append("workflow requested operator approval coverage but no approval was submitted")
    expected_steering = len(list(run_spec.get("steering_script") or []))
    if expected_steering > 0 and len(steering_actions) < expected_steering:
        failures.append("workflow requested steering coverage but steering was not fully submitted")
    return failures


def execute_run(
    api: Any,
    playbook: dict[str, Any],
    run_spec: dict[str, Any],
    *,
    results_dir: Path,
    timeout_seconds: int | None = None,
    poll_interval_seconds: int | None = None,
    sleep_fn=time.sleep,
    time_fn=time.time,
) -> dict[str, Any]:
    timeout_budget = default_timeout_seconds() if timeout_seconds is None else timeout_seconds
    poll_interval = default_poll_interval_seconds() if poll_interval_seconds is None else poll_interval_seconds
    prepared_workspace = prepare_workspace_materials(run_spec, output_root=results_dir / "prepared-workspaces")
    workspace_payload = build_workspace_create_input(
        run_spec,
        prepared_host_path=prepared_workspace.get("host_path"),
        repository_url=prepared_workspace.get("repository_url"),
        default_branch=prepared_workspace.get("default_branch"),
    )
    workspace = api.create_workspace(workspace_payload)
    workflow_payload = build_workflow_launch_payload(
        playbook,
        workspace_id=str(workspace["id"]),
        run_spec=run_spec,
    )
    workflow = api.create_workflow(workflow_payload)

    deadline = time_fn() + timeout_budget
    approval_actions: list[dict[str, Any]] = []
    steering_actions: list[dict[str, Any]] = []
    consumed_approval_action_indices: set[int] = set()
    processed_gate_ids: set[str] = set()
    consumed_steering_indices: set[int] = set()
    latest_workflow = workflow
    latest_work_items: list[dict[str, Any]] = []
    latest_briefs: list[dict[str, Any]] = []
    latest_approvals: dict[str, Any] = {"stage_gates": [], "task_approvals": []}
    timed_out = False

    while True:
        latest_workflow = api.get_workflow(str(workflow["id"]))
        latest_work_items = list(api.list_work_items(str(workflow["id"])))
        latest_briefs = list(api.list_operator_briefs(str(workflow["id"]), limit=100))
        latest_approvals = dict(api.list_approvals())
        approval_actions.extend(
            submit_pending_operator_approvals(
                api,
                latest_approvals,
                workflow_id=str(workflow["id"]),
                run_spec=run_spec,
                consumed_action_indices=consumed_approval_action_indices,
                processed_gate_ids=processed_gate_ids,
            )
        )
        steering_actions.extend(
            submit_ready_steering_requests(
                api,
                latest_briefs,
                latest_work_items,
                workflow_id=str(workflow["id"]),
                run_spec=run_spec,
                consumed_indices=consumed_steering_indices,
            )
        )
        if str(latest_workflow.get("state") or "").strip() in TERMINAL_WORKFLOW_STATES:
            break
        if time_fn() >= deadline:
            timed_out = True
            break
        sleep_fn(poll_interval)

    workspace_packet = api.get_workspace_packet(str(workflow["id"]))
    packet_summary = summarize_workspace_packet(workspace_packet)
    failures = _evaluate_result(
        run_spec=run_spec,
        workflow=latest_workflow,
        packet_summary=packet_summary,
        briefs=latest_briefs,
        approval_actions=approval_actions,
        steering_actions=steering_actions,
        timed_out=timed_out,
    )
    result_path = _result_path(results_dir, run_spec)
    result = {
        "id": run_spec["id"],
        "batch": run_spec["batch"],
        "playbook_slug": run_spec["playbook_slug"],
        "variant": run_spec["variant"],
        "workspace": workspace,
        "workflow": latest_workflow,
        "expected_outcome": dict(run_spec.get("expected_outcome") or {}),
        "operator_actions": {
            "approvals": approval_actions,
            "steering": steering_actions,
        },
        "observed": {
            "work_item_count": len(latest_work_items),
            "brief_count": len(latest_briefs),
            "workspace_packet": packet_summary,
        },
        "prepared_workspace": prepared_workspace,
        "timed_out": timed_out,
        "passed": len(failures) == 0,
        "failures": failures,
        "result_file": str(result_path),
    }
    write_json_file(result_path, result)
    return result


def execute_runs(
    api: Any,
    playbooks_by_slug: dict[str, dict[str, Any]],
    run_specs: list[dict[str, Any]],
    *,
    results_dir: Path,
    timeout_seconds: int | None = None,
    poll_interval_seconds: int | None = None,
) -> dict[str, Any]:
    ensure_dir(results_dir)
    results: list[dict[str, Any]] = []
    for run_spec in run_specs:
        playbook = playbooks_by_slug.get(str(run_spec["playbook_slug"]))
        if playbook is None:
            missing = {
                "id": run_spec["id"],
                "batch": run_spec["batch"],
                "playbook_slug": run_spec["playbook_slug"],
                "variant": run_spec["variant"],
                "passed": False,
                "failures": [f"imported playbook {run_spec['playbook_slug']!r} was not found locally"],
            }
            result_path = _result_path(results_dir, run_spec)
            missing["result_file"] = str(result_path)
            write_json_file(result_path, missing)
            results.append(missing)
            continue
        results.append(
            execute_run(
                api,
                playbook,
                run_spec,
                results_dir=results_dir,
                timeout_seconds=timeout_seconds,
                poll_interval_seconds=poll_interval_seconds,
            )
        )
    return {
        "runs": results,
        "passed": all(bool(result.get("passed")) for result in results),
        "passed_count": sum(1 for result in results if bool(result.get("passed"))),
        "failed_count": sum(1 for result in results if not bool(result.get("passed"))),
    }
