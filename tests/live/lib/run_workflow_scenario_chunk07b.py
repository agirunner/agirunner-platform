#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk07a import *

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

__all__ = [name for name in globals() if not name.startswith("__")]
