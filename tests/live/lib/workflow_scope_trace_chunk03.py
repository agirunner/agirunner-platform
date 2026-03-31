from workflow_scope_trace_chunk04 import *



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



__all__ = [name for name in globals() if not name.startswith("__")]
