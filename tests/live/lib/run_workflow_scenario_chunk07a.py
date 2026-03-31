#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk06 import *

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

__all__ = [name for name in globals() if not name.startswith("__")]
