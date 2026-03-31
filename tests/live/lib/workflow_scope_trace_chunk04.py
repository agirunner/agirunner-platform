import json
import re
import subprocess
from pathlib import Path
from typing import Any

PACKET_DESCRIPTOR_KINDS = {"brief_packet", "handoff_packet"}
FINAL_DELIVERABLE_STATUSES = {"approved", "completed", "final"}
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
COMPOSE_EXECUTION_TURN_ROWS_SCRIPT = REPO_ROOT / "tests" / "live" / "scripts" / "compose-execution-turn-rows.ts"

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
        return records
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


def read_execution_log_horizon(logs: Any) -> int | None:
    numeric_ids = [
        numeric_id
        for row in execution_log_rows(logs)
        if (numeric_id := parse_execution_log_numeric_id(row.get("id"))) is not None
    ]
    return max(numeric_ids) if numeric_ids else None


def execution_log_id_is_beyond_horizon(log_id: str, horizon: int | None) -> bool:
    numeric_id = parse_execution_log_numeric_id(log_id)
    return horizon is not None and numeric_id is not None and numeric_id > horizon


def parse_execution_log_numeric_id(value: Any) -> int | None:
    parsed = read_string(value)
    if parsed is None or not parsed.isdigit():
        return None
    return int(parsed)


def read_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def read_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]

__all__ = [name for name in globals() if not name.startswith("__")]
