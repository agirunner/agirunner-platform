from workflow_scope_trace_chunk03 import *

def reconcile_enhanced_live_console(
    *,
    execution_logs: dict[str, Any] | None,
    composed_execution_turn_rows: list[dict[str, Any]] | None = None,
    execution_turn_items: list[dict[str, Any]],
    effective_mode: str,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> dict[str, Any]:
    actual_rows = [dict(item) for item in execution_turn_items if isinstance(item, dict)]
    mode = effective_mode if effective_mode in {"standard", "enhanced"} else "unknown"
    if mode != "enhanced":
        return {
            "applicable": False,
            "effective_mode": mode,
            "expected_rows": [],
            "actual_rows": actual_rows,
            "passed": True,
            "failures": [],
        }

    expected_rows = expected_enhanced_live_console_rows(
        execution_logs=execution_logs,
        composed_execution_turn_rows=composed_execution_turn_rows,
        scope_kind=scope_kind,
        work_item_id=work_item_id,
        task_id=task_id,
    )
    expected_by_id = {
        row["log_id"]: row
        for row in expected_rows
        if read_string(row.get("log_id")) is not None
    }
    actual_by_id = {
        row["log_id"]: row
        for row in actual_rows
        if read_string(row.get("log_id")) is not None
    }
    raw_capture_horizon = read_execution_log_horizon(execution_logs)
    failures: list[str] = []

    for expected in expected_rows:
        log_id = read_string(expected.get("log_id"))
        if log_id is None or expected.get("surface_expected") is not True:
            continue
        actual = actual_by_id.get(log_id)
        if actual is None:
            failures.append(f"missing expected enhanced turn line execution-log:{log_id}")
            continue
        mismatch = compare_enhanced_live_console_row(expected=expected, actual=actual)
        if mismatch is not None:
            failures.append(f"execution-log:{log_id} {mismatch}")

    for actual in actual_rows:
        log_id = read_string(actual.get("log_id"))
        if log_id is None:
            failures.append("execution_turn item is missing execution-log linkage")
            continue
        expected = expected_by_id.get(log_id)
        if expected is None:
            if execution_log_id_is_beyond_horizon(log_id, raw_capture_horizon):
                continue
            failures.append(f"execution-log:{log_id} surfaced unexpectedly without a raw loop-phase source")
            continue
        if expected.get("surface_expected") is not True:
            reason = read_string(expected.get("suppression_reason")) or "suppressed"
            failures.append(f"execution-log:{log_id} surfaced unexpectedly for suppressed loop component ({reason})")
        forbidden_fragment = find_forbidden_live_console_fragment(actual)
        if forbidden_fragment is not None:
            failures.append(
                f"execution-log:{log_id} surfaced forbidden live-console fragment {forbidden_fragment!r}"
            )

    return {
        "applicable": True,
        "effective_mode": mode,
        "expected_rows": expected_rows,
        "actual_rows": actual_rows,
        "passed": len(failures) == 0,
        "failures": failures,
    }


def expected_enhanced_live_console_rows(
    *,
    execution_logs: dict[str, Any] | None,
    composed_execution_turn_rows: list[dict[str, Any]] | None,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> list[dict[str, Any]]:
    if composed_execution_turn_rows is not None:
        rows: list[dict[str, Any]] = []
        for row in composed_execution_turn_rows:
            normalized = normalize_composed_execution_turn_row(row)
            if enhanced_row_matches_scope(
                normalized,
                scope_kind=scope_kind,
                work_item_id=work_item_id,
                task_id=task_id,
            ):
                rows.append(normalized)
        return rows

    rows: list[dict[str, Any]] = []
    for row in execution_log_rows(execution_logs):
        normalized = compose_expected_execution_turn_row(row)
        if normalized is None or not enhanced_row_matches_scope(
            normalized,
            scope_kind=scope_kind,
            work_item_id=work_item_id,
            task_id=task_id,
        ):
            continue
        if should_suppress_adjacent_expected_row(rows[-1] if rows else None, normalized):
            continue
        rows.append(normalized)
    return rows


def summarize_execution_turn_items(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for record in records:
        if read_string(record.get("item_kind")) != "execution_turn":
            continue
        item_id = read_string(record.get("item_id"))
        items.append(
            {
                "log_id": read_execution_log_id(item_id),
                "item_id": item_id,
                "headline": read_string(record.get("headline")),
                "summary": read_string(record.get("summary")),
                "task_id": read_string(record.get("task_id")),
                "work_item_id": read_string(record.get("work_item_id")),
            }
        )
    return items


def load_composed_execution_turn_rows(execution_logs: dict[str, Any] | None) -> list[dict[str, Any]] | None:
    if not isinstance(execution_logs, dict):
        return None

    precomposed = execution_logs.get("composed_execution_turn_rows")
    if isinstance(precomposed, list):
        return [dict(item) for item in precomposed if isinstance(item, dict)]

    raw_rows = execution_log_rows(execution_logs)
    if len(raw_rows) == 0:
        return []

    if not COMPOSE_EXECUTION_TURN_ROWS_SCRIPT.is_file():
        return None

    try:
        result = subprocess.run(
            [
                "corepack",
                "pnpm",
                "exec",
                "tsx",
                str(COMPOSE_EXECUTION_TURN_ROWS_SCRIPT),
            ],
            cwd=REPO_ROOT,
            input=json.dumps({"rows": raw_rows}),
            text=True,
            capture_output=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    items = payload.get("items")
    if not isinstance(items, list):
        return None
    return [dict(item) for item in items if isinstance(item, dict)]


def normalize_composed_execution_turn_row(row: dict[str, Any]) -> dict[str, Any]:
    linked_target_ids = [
        value
        for value in as_list(row.get("linked_target_ids"))
        if isinstance(value, str) and value.strip() != ""
    ]
    return {
        "log_id": read_string(row.get("log_id")),
        "item_id": read_string(row.get("item_id")),
        "headline": read_string(row.get("headline")),
        "summary": read_string(row.get("summary")),
        "task_id": read_string(row.get("task_id")),
        "work_item_id": read_string(row.get("work_item_id")),
        "scope_binding": read_string(row.get("scope_binding")),
        "linked_target_ids": linked_target_ids,
        "surface_expected": True,
        "surface_kind": "execution_turn",
        "expected_headline": read_string(row.get("headline")),
        "expected_summary": read_string(row.get("summary")),
        "tool_name": None,
        "suppression_reason": None,
    }


def compose_expected_execution_turn_row(row: dict[str, Any]) -> dict[str, Any] | None:
    operation = read_string(row.get("operation"))
    if operation not in ENHANCED_LOOP_PHASE_OPERATIONS:
        return None
    payload = as_record(row.get("payload"))
    phase = read_string(payload.get("phase")) or ENHANCED_LOOP_PHASE_OPERATIONS[operation]
    scope = resolve_expected_execution_turn_scope(row, payload)
    headline = build_expected_execution_turn_headline(operation, payload)
    summary = build_expected_execution_turn_summary(operation, payload)
    base = {
        "log_id": read_string(row.get("id")),
        "operation": operation,
        "phase": phase,
        "phase_label": read_phase_label(operation),
        "task_id": scope["task_id"],
        "work_item_id": scope["work_item_id"],
        "scope_binding": scope["scope_binding"],
        "linked_target_ids": scope["linked_target_ids"],
        "surface_expected": False,
        "surface_kind": "execution_turn",
        "expected_headline": None,
        "expected_summary": None,
        "tool_name": None,
        "suppression_reason": None,
    }
    if not should_render_expected_execution_turn(operation, payload, headline):
        return {**base, "suppression_reason": read_suppression_reason(operation, payload, headline)}
    if headline is None:
        return None
    return {
        **base,
        "surface_expected": True,
        "expected_headline": headline,
        "expected_summary": summary,
        "tool_name": read_action_name(payload),
    }


def enhanced_row_matches_scope(
    row: dict[str, Any],
    *,
    scope_kind: str,
    work_item_id: str | None,
    task_id: str | None,
) -> bool:
    if scope_kind == "workflow":
        return True
    if scope_kind == "selected_task":
        return read_string(row.get("task_id")) == task_id
    return read_string(row.get("work_item_id")) == work_item_id


def compare_enhanced_live_console_row(
    *,
    expected: dict[str, Any],
    actual: dict[str, Any],
) -> str | None:
    expected_task_id = read_string(expected.get("task_id"))
    actual_task_id = read_string(actual.get("task_id"))
    if expected_task_id != actual_task_id:
        return "task scope mismatch"
    expected_work_item_id = read_string(expected.get("work_item_id"))
    actual_work_item_id = read_string(actual.get("work_item_id"))
    if expected_work_item_id != actual_work_item_id:
        return "work item scope mismatch"

    headline = normalized_text(actual.get("headline"))
    if headline is None:
        return "headline is missing"
    expected_headline = normalized_text(expected.get("expected_headline"))
    if expected_headline is None:
        return None
    if not preview_matches(actual=headline, expected=expected_headline):
        return "headline did not match the canonical execution-turn headline"
    return None


def should_render_expected_execution_turn(
    operation: str,
    payload: dict[str, Any],
    headline: str | None,
) -> bool:
    if operation == "agent.think":
        return read_think_text(payload) is not None
    if operation == "agent.plan":
        return read_plan_text(payload) is not None
    if operation == "agent.act":
        action_name = read_action_name(payload)
        if is_suppressed_action_name(action_name) or is_low_value_helper_action(action_name):
            return False
        return read_act_text(payload, headline) is not None or headline is not None
    if operation == "agent.observe":
        return read_observe_text(payload) is not None
    if operation == "agent.verify":
        return is_meaningful_verify(payload)
    return headline is not None


def read_suppression_reason(
    operation: str,
    payload: dict[str, Any],
    headline: str | None,
) -> str:
    if operation == "agent.act":
        action_name = read_action_name(payload)
        if is_suppressed_action_name(action_name):
            return "internal_operator_record"
        if is_low_value_helper_action(action_name):
            return "low_value_helper_action"
        if read_act_text(payload, headline) is None and headline is None:
            return "missing_operator_meaningful_action_text"
    return "suppressed"


def build_expected_execution_turn_headline(
    operation: str,
    payload: dict[str, Any],
) -> str | None:
    if operation == "agent.think":
        detail = read_think_text(payload)
    elif operation == "agent.plan":
        detail = read_plan_text(payload)
    elif operation == "agent.act":
        action_headline = build_action_headline(payload)
        detail = read_act_text(payload, action_headline) or action_headline
    elif operation == "agent.observe":
        detail = read_observe_text(payload)
    elif operation == "agent.verify":
        detail = read_verify_text(payload) or read_operator_readable_text(build_verify_headline(payload), 180)
    else:
        detail = None
    if detail is None:
        return None
    return format_execution_phase_headline(operation, detail)


def build_expected_execution_turn_summary(
    operation: str,
    payload: dict[str, Any],
) -> str | None:
    return (
        read_act_summary(payload)
        or read_plan_text(payload)
        or read_think_text(payload)
        or read_observe_text(payload)
        or read_verify_text(payload)
        or read_operator_readable_field(payload, ["summary", "details", "reasoning_summary", "approach"])
        or build_execution_turn_fallback_summary(operation)
    )


def resolve_expected_execution_turn_scope(
    row: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    targets = extract_structured_target_ids(as_record(payload.get("input")))
    if not targets["work_item_ids"] and not targets["task_ids"]:
        linked_target_ids = dedupe_ids(
            [
                read_string(row.get("workflow_id")),
                read_string(row.get("work_item_id")),
                read_string(row.get("task_id")),
            ]
        )
        return {
            "scope_binding": "execution_context",
            "work_item_id": read_string(row.get("work_item_id")),
            "task_id": read_string(row.get("task_id")),
            "linked_target_ids": linked_target_ids,
        }
    return {
        "scope_binding": "structured_target",
        "work_item_id": targets["work_item_ids"][0] if targets["work_item_ids"] else None,
        "task_id": targets["task_ids"][0] if targets["task_ids"] else None,
        "linked_target_ids": dedupe_ids(
            [read_string(row.get("workflow_id")), *targets["work_item_ids"], *targets["task_ids"]]
        ),
    }

__all__ = [name for name in globals() if not name.startswith("__")]
