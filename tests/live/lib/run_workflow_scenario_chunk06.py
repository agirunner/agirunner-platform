#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk05 import *

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



__all__ = [name for name in globals() if not name.startswith("__")]
