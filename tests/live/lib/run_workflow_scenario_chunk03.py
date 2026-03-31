#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk02 import *


def _workflow_tasks(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = workflow.get("tasks", [])
    return tasks if isinstance(tasks, list) else []


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


def _normalize_output_artifact_entry(
    artifact: dict[str, Any],
    *,
    task: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    path = str(
        artifact.get("path")
        or artifact.get("logical_path")
        or artifact.get("artifact_path")
        or ""
    ).strip()
    if path == "":
        return None

    task_payload = task if isinstance(task, dict) else {}
    logical_path = str(artifact.get("logical_path") or "").strip() or Path(path).name
    size_value = artifact.get("size_bytes", artifact.get("size"))
    size_bytes = size_value if isinstance(size_value, int) and size_value >= 0 else None
    created_at = (
        artifact.get("created_at")
        or task_payload.get("completed_at")
        or task_payload.get("updated_at")
        or task_payload.get("created_at")
    )
    normalized = {
        "kind": str(artifact.get("kind") or "file"),
        "artifact_id": artifact.get("id") or artifact.get("artifact_id"),
        "task_id": task_payload.get("id") or artifact.get("task_id"),
        "work_item_id": task_payload.get("work_item_id") or artifact.get("work_item_id"),
        "role": task_payload.get("role") or artifact.get("role"),
        "path": path,
        "logical_path": logical_path,
        "content_type": artifact.get("content_type"),
        "size_bytes": size_bytes,
        "created_at": created_at,
    }
    return normalized


def _settled_produced_artifacts(workflow: dict[str, Any], snapshot: Any) -> list[dict[str, Any]]:
    completed_task_artifacts: list[dict[str, Any]] = []
    seen_paths: set[tuple[str, str]] = set()

    for task in _workflow_tasks(workflow):
        if not isinstance(task, dict):
            continue
        if bool(task.get("is_orchestrator_task")):
            continue
        if task.get("state") != "completed":
            continue
        output = task.get("output")
        if not isinstance(output, dict):
            continue
        artifacts = output.get("artifacts")
        if not isinstance(artifacts, list):
            continue
        task_id = str(task.get("id") or "").strip()
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                continue
            normalized = _normalize_output_artifact_entry(artifact, task=task)
            if normalized is None:
                continue
            dedupe_key = (task_id, str(normalized.get("path") or ""))
            if dedupe_key in seen_paths:
                continue
            seen_paths.add(dedupe_key)
            completed_task_artifacts.append(normalized)

    if completed_task_artifacts:
        return completed_task_artifacts

    snapshot_artifacts: list[dict[str, Any]] = []
    for artifact in _artifacts(snapshot):
        if not isinstance(artifact, dict):
            continue
        normalized = _normalize_output_artifact_entry(artifact)
        if normalized is None:
            continue
        snapshot_artifacts.append(normalized)
    if snapshot_artifacts:
        return snapshot_artifacts

    return [
        {
            "kind": "file",
            "artifact_id": None,
            "task_id": None,
            "work_item_id": None,
            "role": None,
            "path": artifact_path,
            "logical_path": Path(artifact_path).name,
            "content_type": None,
            "size_bytes": None,
            "created_at": None,
        }
        for artifact_path in _workflow_final_artifacts(workflow)
    ]


def _build_settled_artifacts_snapshot(
    workflow: dict[str, Any],
    snapshot: Any,
) -> dict[str, Any]:
    artifacts = _settled_produced_artifacts(workflow, snapshot)
    unique_work_item_ids = {
        str(artifact.get("work_item_id"))
        for artifact in artifacts
        if isinstance(artifact.get("work_item_id"), str) and str(artifact.get("work_item_id")).strip() != ""
    }
    unique_task_ids = {
        str(artifact.get("task_id"))
        for artifact in artifacts
        if isinstance(artifact.get("task_id"), str) and str(artifact.get("task_id")).strip() != ""
    }
    unique_roles = {
        str(artifact.get("role"))
        for artifact in artifacts
        if isinstance(artifact.get("role"), str) and str(artifact.get("role")).strip() != ""
    }
    content_types = {
        str(artifact.get("content_type"))
        for artifact in artifacts
        if isinstance(artifact.get("content_type"), str)
        and str(artifact.get("content_type")).strip() != ""
    }
    total_bytes = sum(
        int(artifact.get("size_bytes"))
        for artifact in artifacts
        if isinstance(artifact.get("size_bytes"), int)
    )
    return {
        "ok": True,
        "data": {
            "data": artifacts,
            "meta": {
                "page": 1,
                "per_page": max(len(artifacts), 1),
                "total": len(artifacts),
                "total_pages": 1,
                "has_more": False,
                "summary": {
                    "total_artifacts": len(artifacts),
                    "previewable_artifacts": 0,
                    "total_bytes": total_bytes,
                    "workflow_count": 1 if artifacts else 0,
                    "work_item_count": len(unique_work_item_ids),
                    "task_count": len(unique_task_ids),
                    "role_count": len(unique_roles),
                },
                "filters": {
                    "workflows": [workflow.get("id")] if workflow.get("id") else [],
                    "work_items": sorted(unique_work_item_ids),
                    "tasks": sorted(unique_task_ids),
                    "stages": [],
                    "roles": sorted(unique_roles),
                    "content_types": sorted(content_types),
                },
            },
        },
    }


def _build_final_outputs(
    workflow: dict[str, Any],
    work_items_snapshot: Any,
    evidence: dict[str, Any] | None,
    produced_artifacts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    evidence_payload = evidence if isinstance(evidence, dict) else {}
    db_state = evidence_payload.get("db_state")
    if not isinstance(db_state, dict):
        return []

    deliverables = db_state.get("deliverables")
    if not isinstance(deliverables, list):
        return []
    completed_handoffs = db_state.get("completed_handoffs")
    if not isinstance(completed_handoffs, list):
        completed_handoffs = []

    work_item_map = {
        str(item.get("id")): item
        for item in _work_items(work_items_snapshot)
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    task_map = {
        str(task.get("id")): task
        for task in _workflow_tasks(workflow)
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    handoff_by_work_item = {
        str(handoff.get("work_item_id")): handoff
        for handoff in completed_handoffs
        if isinstance(handoff, dict) and isinstance(handoff.get("work_item_id"), str)
    }
    artifacts_by_task: dict[str, list[dict[str, Any]]] = {}
    for artifact in produced_artifacts:
        if not isinstance(artifact, dict):
            continue
        task_id = artifact.get("task_id")
        if not isinstance(task_id, str) or task_id.strip() == "":
            continue
        artifacts_by_task.setdefault(task_id, []).append(artifact)

    final_outputs: list[dict[str, Any]] = []
    for deliverable in deliverables:
        if not isinstance(deliverable, dict):
            continue
        if deliverable.get("state") != "final" and deliverable.get("delivery_stage") != "final":
            continue
        work_item_id = str(deliverable.get("work_item_id") or "").strip()
        handoff = handoff_by_work_item.get(work_item_id, {})
        task_id = str(handoff.get("task_id") or "").strip()
        task = task_map.get(task_id, {})
        work_item = work_item_map.get(work_item_id, {})
        output_artifacts = list(artifacts_by_task.get(task_id, []))
        final_outputs.append(
            {
                "descriptor_id": deliverable.get("descriptor_id"),
                "descriptor_kind": deliverable.get("descriptor_kind"),
                "delivery_stage": deliverable.get("delivery_stage"),
                "state": deliverable.get("state"),
                "work_item_id": work_item_id or None,
                "work_item_title": work_item.get("title"),
                "stage_name": work_item.get("stage_name"),
                "task_id": task_id or None,
                "task_title": task.get("title"),
                "role": handoff.get("role") or task.get("role"),
                "handoff_id": handoff.get("id"),
                "handoff_created_at": handoff.get("created_at"),
                "artifact_count": len(output_artifacts),
                "artifacts": output_artifacts,
            }
        )
    return final_outputs


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

__all__ = [name for name in globals() if not name.startswith("__")]
