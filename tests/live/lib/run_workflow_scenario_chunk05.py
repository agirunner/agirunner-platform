#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk04 import *

def summarize_log_anomalies(logs: Any) -> dict[str, Any]:
    rows = [
        row
        for row in execution_log_rows(logs)
        if isinstance(row, dict)
        and (
            str(row.get("level") or "").lower() in {"warn", "warning", "error"}
            or str(row.get("status") or "").lower() == "failed"
        )
    ]
    return {"count": len(rows), "rows": rows}


HTTP_STATUS_PATTERN = re.compile(r"\bstatus (?P<status>\d{3})\b")


def _http_status_messages_from_row(row: dict[str, Any]) -> list[str]:
    messages: list[str] = []

    def append_message(value: Any) -> None:
        if isinstance(value, str) and value.strip() != "":
            messages.append(value)

    append_message(row.get("message"))
    error = row.get("error")
    if isinstance(error, dict):
        append_message(error.get("message"))
    else:
        append_message(error)
    payload = row.get("payload")
    if isinstance(payload, dict):
        append_message(payload.get("message"))
        append_message(payload.get("error"))
        output = payload.get("output")
        if isinstance(output, dict):
            append_message(output.get("message"))
            append_message(output.get("error"))
        else:
            append_message(output)
    return messages


def summarize_http_status_anomalies(logs: Any) -> dict[str, Any]:
    status_counts: dict[str, int] = {}
    rows: list[dict[str, Any]] = []
    client_error_count = 0
    server_error_count = 0
    for row in execution_log_rows(logs):
        if not isinstance(row, dict):
            continue
        matched_statuses = {
            match.group("status")
            for message in _http_status_messages_from_row(row)
            for match in [HTTP_STATUS_PATTERN.search(message)]
            if match is not None
        }
        if not matched_statuses:
            continue
        for status in matched_statuses:
            status_counts[status] = status_counts.get(status, 0) + 1
            status_code = int(status)
            if 400 <= status_code <= 499:
                client_error_count += 1
            elif 500 <= status_code <= 599:
                server_error_count += 1
        rows.append(
            {
                "id": row.get("id"),
                "task_id": row.get("task_id"),
                "operation": row.get("operation"),
                "level": row.get("level"),
                "status": row.get("status"),
                "http_statuses": sorted(matched_statuses),
            }
        )
    return {
        "count": len(rows),
        "status_counts": status_counts,
        "client_error_count": client_error_count,
        "server_error_count": server_error_count,
        "rows": rows,
    }


def _completion_callouts(source: Any) -> dict[str, Any]:
    if not isinstance(source, dict):
        return {}
    callouts = source.get("completion_callouts")
    return callouts if isinstance(callouts, dict) else {}


def _count_completion_notes(callouts: dict[str, Any]) -> int:
    notes = callouts.get("completion_notes")
    if isinstance(notes, str):
        return 1 if notes.strip() != "" else 0
    if isinstance(notes, list):
        return sum(1 for note in notes if isinstance(note, str) and note.strip() != "")
    return 0


def _count_list_entries(value: Any) -> int:
    if not isinstance(value, list):
        return 0
    return len(value)


def _count_work_item_completion_callout_entries(work_items: Any, key: str) -> int:
    total = 0
    for item in _work_items(work_items):
        total += _count_list_entries(_completion_callouts(item).get(key))
    return total


def _tool_name_from_row(row: dict[str, Any]) -> str:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return ""
    tool = payload.get("tool")
    return str(tool).strip() if isinstance(tool, str) else ""


def _tool_result_output(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return {}
    output = payload.get("output")
    if isinstance(output, dict):
        return output
    if not isinstance(output, str) or output.strip() == "":
        return {}
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _count_anomaly_levels(rows: list[dict[str, Any]]) -> tuple[int, int]:
    warning_count = 0
    error_count = 0
    for row in rows:
        level = str(row.get("level") or "").lower()
        if level in {"warn", "warning"}:
            warning_count += 1
            continue
        if level in {"error", "fatal"} or str(row.get("status") or "").lower() == "failed":
            error_count += 1
    return warning_count, error_count


def _execution_row_actor_handle(row: dict[str, Any]) -> str:
    actor_name = str(row.get("actor_name") or "").strip()
    if actor_name and actor_name.lower() not in {"worker", "agent", "runtime"}:
        return actor_name
    actor_id = str(row.get("actor_id") or "").strip()
    if actor_id and actor_id.lower() not in {"worker", "agent", "runtime"}:
        return actor_id
    return ""


def _distinct_orchestrator_runtime_actors(execution_logs: Any) -> list[str]:
    actors: set[str] = set()
    for row in execution_log_rows(execution_logs):
        role = str(row.get("role") or "").strip()
        if role != "orchestrator":
            continue
        operation = str(row.get("operation") or "").strip()
        if operation not in {"task.execute", "tool.execute", "runtime.task.start"}:
            continue
        actor = _execution_row_actor_handle(row)
        if actor:
            actors.add(actor)
    return sorted(actors)


def _count_container_kinds(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        kind = row.get("kind")
        if not isinstance(kind, str) or kind.strip() == "":
            continue
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def _task_metric_int(task: dict[str, Any], key: str) -> int:
    metrics = task.get("metrics")
    if not isinstance(metrics, dict):
        return 0
    value = metrics.get(key)
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def build_scenario_outcome_metrics(
    *,
    final_state: str,
    verification: dict[str, Any],
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    stage_gates: Any,
    artifacts: Any,
    approval_actions: list[dict[str, Any]],
    workflow_actions: list[dict[str, Any]],
    execution_logs: Any,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    verification_payload = verification if isinstance(verification, dict) else {}
    workflow_callouts = _completion_callouts(workflow)
    unresolved_advisory_item_count = _count_list_entries(
        workflow_callouts.get("unresolved_advisory_items")
    ) + _count_work_item_completion_callout_entries(work_items, "unresolved_advisory_items")
    helper_tool_counts: dict[str, int] = {}
    recoverable_mutation_count = 0
    recovery_class_counts: dict[str, int] = {}
    suggested_next_action_count = 0

    for row in execution_log_rows(execution_logs):
        operation = str(row.get("operation") or "").strip()
        if operation == "tool_call":
            tool_name = _tool_name_from_row(row)
            if tool_name in GUIDED_CLOSURE_HELPER_TOOLS:
                helper_tool_counts[tool_name] = helper_tool_counts.get(tool_name, 0) + 1
            continue
        if operation != "tool_result":
            continue
        output = _tool_result_output(row)
        if output.get("mutation_outcome") != "recoverable_not_applied":
            continue
        recoverable_mutation_count += 1
        recovery_class = output.get("recovery_class")
        if isinstance(recovery_class, str) and recovery_class.strip() != "":
            recovery_class_counts[recovery_class] = recovery_class_counts.get(recovery_class, 0) + 1
        suggested_next_actions = output.get("suggested_next_actions")
        if isinstance(suggested_next_actions, list):
            suggested_next_action_count += len(suggested_next_actions)

    gate_effect_counts: dict[str, int] = {}
    for gate in _stage_gates(stage_gates):
        if not isinstance(gate, dict):
            continue
        closure_effect = gate.get("closure_effect")
        if not isinstance(closure_effect, str) or closure_effect.strip() == "":
            continue
        gate_effect_counts[closure_effect] = gate_effect_counts.get(closure_effect, 0) + 1

    anomalies = evidence.get("log_anomalies", {})
    anomaly_rows = anomalies.get("rows", []) if isinstance(anomalies, dict) else []
    if not isinstance(anomaly_rows, list):
        anomaly_rows = []
    warning_count, error_count = _count_anomaly_levels(
        [row for row in anomaly_rows if isinstance(row, dict)]
    )
    http_status_summary = evidence.get("http_status_summary", {})
    http_status_counts: dict[str, int] = {}
    http_client_error_count = 0
    http_server_error_count = 0
    if isinstance(http_status_summary, dict):
        maybe_status_counts = http_status_summary.get("status_counts")
        if isinstance(maybe_status_counts, dict):
            http_status_counts = {
                str(key): int(value)
                for key, value in maybe_status_counts.items()
                if isinstance(key, str) and isinstance(value, int)
            }
        maybe_client_error_count = http_status_summary.get("client_error_count")
        if isinstance(maybe_client_error_count, int):
            http_client_error_count = maybe_client_error_count
        maybe_server_error_count = http_status_summary.get("server_error_count")
        if isinstance(maybe_server_error_count, int):
            http_server_error_count = maybe_server_error_count

    runtime_cleanup = evidence.get("runtime_cleanup", {})
    runtime_cleanup_passed = isinstance(runtime_cleanup, dict) and bool(runtime_cleanup.get("all_clean"))
    runtime_cleanup_rows = runtime_cleanup.get("runtime_containers", []) if isinstance(runtime_cleanup, dict) else []
    if not isinstance(runtime_cleanup_rows, list):
        runtime_cleanup_rows = []
    live_containers = evidence.get("live_containers", {})
    live_container_rows = _live_container_rows(live_containers)
    container_observations = evidence.get("container_observations", {})
    observed_container_rows = container_observation_rows(container_observations)
    execution_environment_usage = evidence.get("execution_environment_usage", {})
    if not isinstance(execution_environment_usage, dict):
        execution_environment_usage = {}
    workflow_tasks = _workflow_tasks(workflow)
    orchestrator_runtime_actors = _distinct_orchestrator_runtime_actors(execution_logs)
    orchestrator_tasks = [
        task
        for task in workflow_tasks
        if isinstance(task, dict) and bool(task.get("is_orchestrator_task"))
    ]
    specialist_tasks = [
        task
        for task in workflow_tasks
        if isinstance(task, dict) and not bool(task.get("is_orchestrator_task"))
    ]

    return {
        "status": "passed" if bool(verification_payload.get("passed")) else "failed",
        "workflow_state": final_state,
        "success": {
            "output_artifact_count": output_artifact_count(workflow=workflow, snapshot=artifacts),
            "completed_non_orchestrator_task_count": completed_non_orchestrator_task_count(workflow),
            "terminal_work_item_count": _completed_work_item_count(work_items, board),
            "approval_action_count": len(approval_actions),
            "workflow_action_count": len(workflow_actions),
        },
        "closure": {
            "completion_note_count": _count_completion_notes(workflow_callouts),
            "residual_risk_count": _count_list_entries(workflow_callouts.get("residual_risks")),
            "waived_step_count": _count_list_entries(workflow_callouts.get("waived_steps")),
            "unresolved_advisory_item_count": unresolved_advisory_item_count,
        },
        "invoked_controls": {
            "closure_effect_counts": gate_effect_counts,
        },
        "orchestrator_improvisation": {
            "helper_tool_usage_count": sum(helper_tool_counts.values()),
            "helper_tool_counts": helper_tool_counts,
            "recoverable_mutation_count": recoverable_mutation_count,
            "recovery_class_counts": recovery_class_counts,
            "suggested_next_action_count": suggested_next_action_count,
        },
        "verification": {
            "advisory_count": len(verification_payload.get("advisories", []))
            if isinstance(verification_payload.get("advisories"), list)
            else 0,
            "failure_count": len(verification_payload.get("failures", []))
            if isinstance(verification_payload.get("failures"), list)
            else 0,
        },
        "agentic_effort": {
            "total_loop_count": sum(_task_metric_int(task, "iterations") for task in workflow_tasks if isinstance(task, dict)),
            "orchestrator_loop_count": sum(_task_metric_int(task, "iterations") for task in orchestrator_tasks),
            "specialist_loop_count": sum(_task_metric_int(task, "iterations") for task in specialist_tasks),
            "input_token_count": sum(_task_metric_int(task, "input_tokens") for task in workflow_tasks if isinstance(task, dict)),
            "output_token_count": sum(_task_metric_int(task, "output_tokens") for task in workflow_tasks if isinstance(task, dict)),
            "total_token_count": sum(_task_metric_int(task, "total_tokens") for task in workflow_tasks if isinstance(task, dict)),
        },
        "orchestrator_distribution": {
            "distinct_runtime_count": len(orchestrator_runtime_actors),
            "runtime_actors": orchestrator_runtime_actors,
        },
        "anomalies": {
            "warning_count": warning_count,
            "error_count": error_count,
            "http_status_counts": http_status_counts,
            "http_client_error_count": http_client_error_count,
            "http_server_error_count": http_server_error_count,
        },
        "hygiene": {
            "runtime_cleanup_passed": runtime_cleanup_passed,
            "runtime_container_count": len([row for row in runtime_cleanup_rows if isinstance(row, dict)]),
            "live_container_kind_counts": _count_container_kinds(
                [row for row in live_container_rows if isinstance(row, dict)]
            ),
            "observed_container_kind_counts": _count_container_kinds(
                [row for row in observed_container_rows if isinstance(row, dict)]
            ),
        },
        "execution_environment_usage": {
            "applicable": bool(execution_environment_usage.get("applicable")),
            "passed": bool(execution_environment_usage.get("passed")),
            "checked_task_count": int(execution_environment_usage.get("checked_task_count", 0) or 0),
            "mismatch_count": int(execution_environment_usage.get("mismatch_count", 0) or 0),
            "observed_environment_ids": execution_environment_usage.get("observed_environment_ids", []),
            "selected_default_environment_id": execution_environment_usage.get("selected_default_environment_id"),
            "tenant_default_environment_id": execution_environment_usage.get("tenant_default_environment_id"),
        },
    }


def _execution_log_rows(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _parse_optional_log_id(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if candidate == "":
        return None
    try:
        return int(candidate)
    except ValueError:
        return None


def _max_execution_log_id(execution_logs: Any) -> int | None:
    log_ids = [
        parsed_id
        for parsed_id in (_parse_optional_log_id(row.get("id")) for row in execution_log_rows(execution_logs))
        if parsed_id is not None
    ]
    if len(log_ids) == 0:
        return None
    return max(log_ids)


def _max_workspace_scope_execution_log_id(workspace_scope_trace: Any) -> int | None:
    if not isinstance(workspace_scope_trace, dict):
        return None

    log_ids: list[int] = []
    for scope_key in ("workflow_scope", "selected_work_item_scope", "selected_task_scope"):
        scope = workspace_scope_trace.get(scope_key)
        if not isinstance(scope, dict):
            continue
        live_console = scope.get("workspace_api", {}).get("live_console", {})
        if not isinstance(live_console, dict):
            continue
        execution_turn_ids = live_console.get("execution_turn_ids", [])
        if not isinstance(execution_turn_ids, list):
            continue
        log_ids.extend(
            parsed_id
            for parsed_id in (_parse_optional_log_id(value) for value in execution_turn_ids)
            if parsed_id is not None
        )
    if len(log_ids) == 0:
        return None
    return max(log_ids)


def collect_consistent_workspace_scope_evidence(
    client: ApiClient,
    *,
    workflow_id: str,
    workflow: dict[str, Any],
    db_state_snapshot: dict[str, Any],
    max_attempts: int = 3,
) -> tuple[dict[str, Any], dict[str, Any]]:
    execution_logs_snapshot = collect_execution_logs(client, workflow_id=workflow_id)
    workspace_scope_trace = build_workspace_scope_trace(
        client,
        workflow_id=workflow_id,
        workflow=workflow,
        db_state=db_state_snapshot,
        execution_logs=execution_logs_snapshot,
    )

    for _ in range(max_attempts - 1):
        max_workspace_scope_log_id = _max_workspace_scope_execution_log_id(workspace_scope_trace)
        max_execution_log_id = _max_execution_log_id(execution_logs_snapshot)
        if max_workspace_scope_log_id is None:
            break
        if max_execution_log_id is not None and max_execution_log_id >= max_workspace_scope_log_id:
            break
        execution_logs_snapshot = collect_execution_logs(client, workflow_id=workflow_id)
        workspace_scope_trace = build_workspace_scope_trace(
            client,
            workflow_id=workflow_id,
            workflow=workflow,
            db_state=db_state_snapshot,
            execution_logs=execution_logs_snapshot,
        )

    return execution_logs_snapshot, workspace_scope_trace


def execution_log_rows(logs: Any) -> list[dict[str, Any]]:
    if isinstance(logs, list):
        return [row for row in logs if isinstance(row, dict)]
    if isinstance(logs, dict):
        rows = logs.get("data", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def _completed_work_item_count(work_items_snapshot: Any, board_snapshot: Any) -> int:
    return sum(1 for item in _work_items(work_items_snapshot) if _work_item_is_terminal(item, board_snapshot))


def _open_work_item_count(work_items_snapshot: Any, board_snapshot: Any) -> int:
    return sum(1 for item in _work_items(work_items_snapshot) if not _work_item_is_terminal(item, board_snapshot))

__all__ = [name for name in globals() if not name.startswith("__")]
