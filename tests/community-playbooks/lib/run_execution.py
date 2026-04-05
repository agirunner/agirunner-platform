#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from common import ensure_dir, write_json_file
from operator_flow import (
    TERMINAL_WORKFLOW_STATES,
    pending_workflow_approvals,
    select_work_item_for_steering,
    submit_pending_operator_approvals,
    submit_ready_steering_requests,
)
from provider_fail_fast import detect_nonrecoverable_provider_blocker
from run_playbook import build_workflow_launch_payload
from workspace_prep import build_workspace_create_input, prepare_workspace_materials


def _apply_profile_default_execution_environment(api: Any, run_spec: dict[str, Any]) -> dict[str, Any] | None:
    profile = dict(run_spec.get("workspace_profile_record") or {})
    alias = str(profile.get("default_execution_environment_alias") or "").strip()
    if alias == "":
        return None

    for environment in api.list_execution_environments():
        if not isinstance(environment, dict):
            continue
        candidate_aliases = {
            str(environment.get("slug") or "").strip(),
            str(environment.get("catalog_key") or "").strip(),
        }
        if alias not in candidate_aliases:
            continue
        environment_id = str(environment.get("id") or "").strip()
        if environment_id == "":
            raise RuntimeError(f"execution environment alias {alias!r} is missing an id")
        api.set_default_execution_environment(environment_id)
        return environment

    raise RuntimeError(f"workspace profile requested unknown default execution environment alias {alias!r}")


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


def _expected_approval_count(run_spec: dict[str, Any]) -> int:
    return sum(
        1
        for action in list(run_spec.get("operator_actions") or [])
        if isinstance(action, dict) and str(action.get("kind") or "").strip() == "approval"
    )


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


def _pending_manual_operator_actions(
    *,
    run_spec: dict[str, Any],
    workflow_id: str,
    approvals: dict[str, Any],
    briefs: list[dict[str, Any]],
    work_items: list[dict[str, Any]],
) -> dict[str, Any]:
    pending_approvals = pending_workflow_approvals(approvals, workflow_id)
    steering_targets: list[dict[str, Any]] = []
    for action in list(run_spec.get("steering_script") or []):
        if not isinstance(action, dict):
            continue
        if not _steering_condition_met(action, briefs=briefs, work_items=work_items):
            continue
        target = select_work_item_for_steering(
            work_items,
            preferred_title=action.get("work_item_title"),
        )
        if target is None:
            continue
        steering_targets.append(
            {
                "message": str(action.get("message") or "").strip(),
                "work_item_id": str(target.get("id") or "").strip() or None,
                "work_item_title": str(target.get("title") or "").strip() or None,
            }
        )
    return {
        "ready": bool(pending_approvals or steering_targets),
        "pending_approvals": pending_approvals,
        "pending_steering_targets": steering_targets,
    }


def _result_path(results_dir: Path, run_spec: dict[str, Any]) -> Path:
    return results_dir / str(run_spec["batch"]) / str(run_spec["playbook_slug"]) / f"{run_spec['variant']}.json"


def _has_observable_output(packet_summary: dict[str, Any], briefs: list[dict[str, Any]]) -> bool:
    return (
        packet_summary["final_deliverable_count"] > 0
        or packet_summary["in_progress_deliverable_count"] > 0
        or packet_summary["live_console_total"] > 0
        or len(briefs) > 0
    )


def _final_deliverables(packet: dict[str, Any]) -> list[dict[str, Any]]:
    deliverables = packet.get("deliverables")
    if not isinstance(deliverables, dict):
        return []
    final_deliverables = deliverables.get("final_deliverables")
    if not isinstance(final_deliverables, list):
        return []
    return [item for item in final_deliverables if isinstance(item, dict)]


def _is_packet_like_deliverable(item: dict[str, Any]) -> bool:
    descriptor_kind = str(item.get("descriptor_kind") or "").strip().lower()
    return descriptor_kind in {"deliverable_packet", "brief_packet", "handoff_packet"}


def _content_final_deliverables(packet: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in _final_deliverables(packet) if not _is_packet_like_deliverable(item)]


def _read_deliverable_preview(api: Any, item: dict[str, Any]) -> str:
    read_api_path = getattr(api, "read_api_path", None)
    if not callable(read_api_path):
        return ""
    primary_target = item.get("primary_target")
    if not isinstance(primary_target, dict):
        return ""
    target_url = str(primary_target.get("url") or "").strip()
    if target_url == "":
        return ""
    preview = read_api_path(target_url)
    if isinstance(preview, str):
        return preview
    return json.dumps(preview, sort_keys=True)


def _contains_provider_web_search(logs: list[dict[str, Any]]) -> bool:
    for item in logs:
        if not isinstance(item, dict):
            continue
        payload = item.get("payload")
        if not isinstance(payload, dict):
            continue
        for provider_tool_calls in _provider_tool_call_groups(payload):
            for call in provider_tool_calls:
                if not isinstance(call, dict):
                    continue
                if str(call.get("name") or "").strip() == "web_search":
                    return True
    return False


def _provider_tool_call_groups(payload: dict[str, Any]) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    direct_calls = payload.get("provider_tool_calls")
    if isinstance(direct_calls, list):
        groups.append([call for call in direct_calls if isinstance(call, dict)])

    nested_output = payload.get("output")
    nested_payload = _decode_json_object(nested_output)
    if nested_payload is None:
        return groups

    nested_calls = nested_payload.get("provider_tool_calls")
    if isinstance(nested_calls, list):
        groups.append([call for call in nested_calls if isinstance(call, dict)])
    return groups


def _decode_json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return None
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(decoded, dict):
        return None
    return decoded


def _has_research_structure(text: str) -> bool:
    normalized = text.lower()
    has_question = (
        "research question" in normalized
        or "question_answered" in normalized
        or "question answered" in normalized
        or normalized.startswith("# final research synthesis")
        or normalized.startswith("# final synthesis")
    )
    has_findings = "findings" in normalized
    has_confidence = "confidence" in normalized
    has_recommendation = (
        "recommendation" in normalized
        or "recommendation_or_next_step" in normalized
        or "next step" in normalized
        or "recommended_next_step" in normalized
    )
    return has_question and has_findings and has_confidence and has_recommendation


def _read_source_visibility(text: str) -> dict[str, bool]:
    normalized = text.lower()
    has_source_basis = (
        "sources consulted" in normalized
        or "sources_consulted" in normalized
        or "source basis" in normalized
        or "evidence basis" in normalized
    )
    has_quality_notes = (
        "source quality" in normalized
        or "quality notes" in normalized
        or "source_quality_notes" in normalized
    )
    return {
        "source_basis_present": has_source_basis,
        "source_quality_notes_present": has_quality_notes,
    }


def _collect_research_brief_observations(
    *,
    api: Any,
    workflow_id: str,
    workspace_packet: dict[str, Any],
) -> dict[str, Any]:
    content_final_deliverables = _content_final_deliverables(workspace_packet)
    final_previews = [_read_deliverable_preview(api, item) for item in content_final_deliverables]
    non_empty_previews = [preview for preview in final_previews if preview.strip() != ""]
    preview_to_report = non_empty_previews[0] if non_empty_previews else ""
    source_visibility = [_read_source_visibility(preview) for preview in non_empty_previews]
    logs = list(api.list_logs(workflow_id=workflow_id, status=None, per_page=500))
    first_content_row = content_final_deliverables[0] if content_final_deliverables else {}
    return {
        "final_deliverable_present": len(content_final_deliverables) > 0,
        "final_content_deliverable_count": len(content_final_deliverables),
        "final_deliverable_title": str(first_content_row.get("title") or "").strip() or None,
        "final_deliverable_filename": str(first_content_row.get("filename") or "").strip() or None,
        "final_deliverable_preview_excerpt": preview_to_report[:500],
        "structured_final_research_present": any(
            _has_research_structure(preview) for preview in non_empty_previews
        ),
        "source_basis_present": any(item["source_basis_present"] for item in source_visibility),
        "source_quality_notes_present": any(
            item["source_quality_notes_present"] for item in source_visibility
        ),
        "native_web_search_used": _contains_provider_web_search(logs),
    }


def _evaluate_research_brief_outcome(
    *,
    expected_outcome: dict[str, Any],
    research_observations: dict[str, Any],
) -> list[str]:
    failures: list[str] = []
    if not bool(research_observations.get("final_deliverable_present")):
        failures.append("final research deliverables only exposed packet rows instead of a real content row")
    if not bool(research_observations.get("structured_final_research_present")):
        failures.append("no final research deliverable preview satisfied the structured research contract")

    if bool(expected_outcome.get("require_source_basis")) and not bool(
        research_observations.get("source_basis_present")
    ):
        failures.append("final research deliverable does not expose a visible source basis")
    if bool(expected_outcome.get("require_source_basis")) and not bool(
        research_observations.get("source_quality_notes_present")
    ):
        failures.append("final research deliverable does not expose visible source quality notes")

    if bool(expected_outcome.get("require_native_web_search")) and not bool(
        research_observations.get("native_web_search_used")
    ):
        failures.append(
            "run required actual provider-managed native web search usage but no web_search evidence was recorded"
        )

    return failures


def _evaluate_result(
    *,
    api: Any,
    run_spec: dict[str, Any],
    workflow: dict[str, Any],
    workspace_packet: dict[str, Any],
    packet_summary: dict[str, Any],
    briefs: list[dict[str, Any]],
    approval_actions: list[dict[str, Any]],
    steering_actions: list[dict[str, Any]],
    timed_out: bool,
    manual_operator_actions: bool,
    manual_action_snapshot: dict[str, Any],
    provider_blocker_message: str | None,
    research_observations: dict[str, Any] | None = None,
) -> list[str]:
    failures: list[str] = []
    if provider_blocker_message:
        failures.append(f"provider blocked live run: {provider_blocker_message}")
        return failures
    final_state = str(workflow.get("state") or "").strip()
    expected_approvals = _expected_approval_count(run_spec)
    expected_steering = len(list(run_spec.get("steering_script") or []))
    if manual_operator_actions:
        if timed_out:
            failures.append("workflow did not surface the expected manual operator action before the timeout")
        if expected_approvals > 0 and len(list(manual_action_snapshot.get("pending_approvals") or [])) == 0:
            failures.append("workflow requested operator approval coverage but no approval reached manual-review state")
        if expected_steering > 0 and len(list(manual_action_snapshot.get("pending_steering_targets") or [])) == 0:
            failures.append("workflow requested steering coverage but no steerable work item reached manual-review state")
        return failures
    if timed_out:
        failures.append("workflow did not reach a terminal state before the timeout")
    elif final_state != "completed":
        failures.append(f"workflow finished in unsupported state {final_state!r}")
    if not _has_observable_output(packet_summary, briefs):
        failures.append("workflow finished without observable output")
    if expected_approvals > 0 and len(approval_actions) == 0:
        failures.append("workflow requested operator approval coverage but no approval was submitted")
    if expected_steering > 0 and len(steering_actions) < expected_steering:
        failures.append("workflow requested steering coverage but steering was not fully submitted")
    expected_outcome = dict(run_spec.get("expected_outcome") or {})
    if str(expected_outcome.get("kind") or "").strip() == "research_brief":
        failures.extend(
            _evaluate_research_brief_outcome(
                expected_outcome=expected_outcome,
                research_observations=research_observations or {},
            )
        )
    return failures


def execute_run(
    api: Any,
    playbook: dict[str, Any],
    run_spec: dict[str, Any],
    *,
    results_dir: Path,
    timeout_seconds: int | None = None,
    poll_interval_seconds: int | None = None,
    manual_operator_actions: bool = False,
    sleep_fn=time.sleep,
    time_fn=time.time,
) -> dict[str, Any]:
    timeout_budget = default_timeout_seconds() if timeout_seconds is None else timeout_seconds
    poll_interval = default_poll_interval_seconds() if poll_interval_seconds is None else poll_interval_seconds
    selected_default_execution_environment = _apply_profile_default_execution_environment(api, run_spec)
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
    manual_action_snapshot: dict[str, Any] = {
        "ready": False,
        "pending_approvals": [],
        "pending_steering_targets": [],
    }
    provider_blocker_message: str | None = None
    timed_out = False

    while True:
        latest_workflow = api.get_workflow(str(workflow["id"]))
        latest_work_items = list(api.list_work_items(str(workflow["id"])))
        latest_briefs = list(api.list_operator_briefs(str(workflow["id"]), limit=100))
        latest_approvals = dict(api.list_approvals())
        provider_blocker_message = detect_nonrecoverable_provider_blocker(
            list(api.list_logs(workflow_id=str(workflow["id"]), per_page=10))
        )
        if provider_blocker_message:
            break
        if manual_operator_actions:
            manual_action_snapshot = _pending_manual_operator_actions(
                run_spec=run_spec,
                workflow_id=str(workflow["id"]),
                approvals=latest_approvals,
                briefs=latest_briefs,
                work_items=latest_work_items,
            )
            if bool(manual_action_snapshot.get("ready")):
                break
        else:
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
    expected_outcome = dict(run_spec.get("expected_outcome") or {})
    research_observations = (
        _collect_research_brief_observations(
            api=api,
            workflow_id=str(workflow["id"]),
            workspace_packet=workspace_packet,
        )
        if str(expected_outcome.get("kind") or "").strip() == "research_brief"
        else {}
    )
    failures = _evaluate_result(
        api=api,
        run_spec=run_spec,
        workflow=latest_workflow,
        workspace_packet=workspace_packet,
        packet_summary=packet_summary,
        briefs=latest_briefs,
        approval_actions=approval_actions,
        steering_actions=steering_actions,
        timed_out=timed_out,
        manual_operator_actions=manual_operator_actions,
        manual_action_snapshot=manual_action_snapshot,
        provider_blocker_message=provider_blocker_message,
        research_observations=research_observations,
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
            "manual_mode": manual_operator_actions,
            "manual_pending": manual_action_snapshot,
            "approvals": approval_actions,
            "steering": steering_actions,
        },
        "observed": {
            "work_item_count": len(latest_work_items),
            "brief_count": len(latest_briefs),
            "workspace_packet": packet_summary,
            **research_observations,
        },
        "prepared_workspace": prepared_workspace,
        "selected_default_execution_environment": selected_default_execution_environment,
        "timed_out": timed_out,
        "provider_blocker_message": provider_blocker_message,
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
    manual_operator_actions: bool = False,
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
                manual_operator_actions=manual_operator_actions,
            )
        )
    return {
        "runs": results,
        "passed": all(bool(result.get("passed")) for result in results),
        "passed_count": sum(1 for result in results if bool(result.get("passed"))),
        "failed_count": sum(1 for result in results if not bool(result.get("passed"))),
    }
