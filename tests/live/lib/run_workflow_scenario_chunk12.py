#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk11 import *

def build_run_result_payload(
    *,
    workflow_id: str,
    final_state: str,
    timed_out: bool,
    poll_iterations: int,
    scenario_name: str,
    approval_mode: str,
    provider_auth_mode: str,
    verification_mode: str,
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    stage_gates: Any | None = None,
    events: Any,
    approvals: Any,
    approval_actions: list[dict[str, Any]],
    workflow_actions: list[dict[str, Any]],
    workspace: dict[str, Any],
    artifacts: Any,
    fleet: Any,
    fleet_peaks: dict[str, int],
    verification: dict[str, Any] | None = None,
    execution_logs: Any | None = None,
    efficiency: dict[str, Any] | None = None,
    evidence: dict[str, Any] | None = None,
    execution_environment: dict[str, Any] | None = None,
    capability_proof: dict[str, Any] | None = None,
) -> dict[str, Any]:
    verification_payload = {} if verification is None else verification
    efficiency_payload = {} if efficiency is None else efficiency
    evidence_payload = {} if evidence is None else evidence
    specialist_teardown = efficiency_payload.get("specialist_teardown")
    if not isinstance(specialist_teardown, dict):
        specialist_teardown = {}
    brief_proof = build_brief_proof(workflow=workflow, logs=execution_logs)
    outcome_metrics = evidence_payload.get("scenario_outcome_metrics")
    if not isinstance(outcome_metrics, dict):
        outcome_metrics = build_scenario_outcome_metrics(
            final_state=final_state,
            verification=verification_payload,
            workflow=workflow,
            board=board,
            work_items=work_items,
            stage_gates=stage_gates,
            artifacts=artifacts,
            approval_actions=approval_actions,
            workflow_actions=workflow_actions,
            execution_logs=execution_logs,
            evidence=evidence_payload,
        )
    settled_artifacts = _build_settled_artifacts_snapshot(workflow, artifacts)
    produced_artifacts = _settled_produced_artifacts(workflow, artifacts)
    final_outputs = _build_final_outputs(
        workflow,
        work_items,
        evidence_payload,
        produced_artifacts,
    )
    return {
        "workflow_id": workflow_id,
        "runner_exit_code": 0 if bool(verification_payload.get("passed")) else 1,
        "state": final_state,
        "workflow_state": final_state,
        "terminal": final_state in TERMINAL_STATES,
        "timed_out": timed_out,
        "poll_iterations": poll_iterations,
        "scenario": scenario_name,
        "scenario_name": scenario_name,
        "approval_mode": approval_mode,
        "provider_auth_mode": provider_auth_mode,
        "verification_mode": verification_mode,
        "workflow": workflow,
        "board": board,
        "work_items": work_items,
        "stage_gates": stage_gates,
        "events": events,
        "approvals": approvals,
        "approval_actions": approval_actions,
        "workflow_actions": workflow_actions,
        "workspace": workspace,
        "artifacts": settled_artifacts,
        "produced_artifacts": produced_artifacts,
        "final_outputs": final_outputs,
        "fleet": fleet,
        "fleet_peaks": fleet_peaks,
        "execution_logs": execution_logs,
        "execution_environment": execution_environment,
        "evidence": evidence_payload,
        "efficiency": efficiency_payload,
        "verification": verification_payload,
        "verification_passed": bool(verification_payload.get("passed")),
        "harness_failure": False,
        "workflow_duration_seconds": efficiency_payload.get("workflow_duration_seconds"),
        "total_llm_turns": efficiency_payload.get("total_llm_turns"),
        "total_tool_steps": efficiency_payload.get("total_tool_steps"),
        "total_bursts": efficiency_payload.get("total_bursts"),
        "orchestrator_max_llm_turns": efficiency_payload.get("orchestrator_max_llm_turns"),
        "non_orchestrator_max_llm_turns": efficiency_payload.get("non_orchestrator_max_llm_turns"),
        "orchestrator_max_llm_turns_per_attempt": efficiency_payload.get(
            "orchestrator_max_llm_turns_per_attempt"
        ),
        "non_orchestrator_max_llm_turns_per_attempt": efficiency_payload.get(
            "non_orchestrator_max_llm_turns_per_attempt"
        ),
        "specialist_teardown_lag_seconds": specialist_teardown.get("max_lag_seconds"),
        "brief_proof": brief_proof,
        "capability_proof": {} if capability_proof is None else capability_proof,
        "outcome_metrics": outcome_metrics,
    }


def build_brief_proof(*, workflow: dict[str, Any], logs: Any) -> dict[str, Any]:
    task_roles = {
        str(task.get("id")): str(task.get("role") or "").strip()
        for task in _workflow_tasks(workflow)
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    task_orchestrator_flags = {
        str(task.get("id")): bool(task.get("is_orchestrator_task"))
        for task in _workflow_tasks(workflow)
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    task_entries: list[dict[str, Any]] = []
    seen_task_ids: set[str] = set()

    for row in execution_log_rows(logs):
        if row.get("operation") == "task.execute" and row.get("status") == "started":
            task_id = row.get("task_id")
            if not isinstance(task_id, str) or task_id.strip() == "" or task_id in seen_task_ids:
                continue
            if task_orchestrator_flags.get(task_id):
                continue
            payload = row.get("payload")
            if not isinstance(payload, dict):
                continue
            task_entries.append(
                {
                    "task_id": task_id,
                    "role": task_roles.get(task_id) or None,
                    "execution_brief_present": bool(payload.get("execution_brief_present")),
                    "execution_brief_path": "/workspace/context/execution-brief.json",
                    "execution_brief_excerpt": payload.get("execution_brief_excerpt"),
                    "execution_brief_hash": payload.get("execution_brief_hash"),
                    "execution_brief_refresh_key": payload.get("execution_brief_refresh_key"),
                    "execution_brief_current_focus": payload.get("execution_brief_current_focus"),
                    "execution_brief_predecessor_handoff_id": payload.get("execution_brief_predecessor_handoff_id"),
                    "execution_brief_memory_ref_keys": payload.get("execution_brief_memory_ref_keys"),
                    "execution_brief_artifact_paths": payload.get("execution_brief_artifact_paths"),
                    "system_prompt_contains_workflow_brief": False,
                    "system_prompt_contains_current_focus": False,
                    "system_prompt_contains_predecessor_context": False,
                    "source": "task.execute.started",
                }
            )
            seen_task_ids.add(task_id)
            continue

        if row.get("operation") != "llm.chat_stream" or row.get("status") != "started":
            continue
        task_id = row.get("task_id")
        if not isinstance(task_id, str) or task_id.strip() == "" or task_id in seen_task_ids:
            continue
        if task_orchestrator_flags.get(task_id):
            continue
        payload = row.get("payload")
        if not isinstance(payload, dict):
            continue
        messages = payload.get("messages")
        if not isinstance(messages, list):
            continue
        system_messages = [
            str(message.get("content") or "")
            for message in messages
            if isinstance(message, dict) and message.get("role") == "system"
        ]
        execution_brief_message = next(
            (
                str(message.get("content") or "")
                for message in messages
                if isinstance(message, dict)
                and message.get("role") == "user"
                and "Authoritative specialist execution brief" in str(message.get("content") or "")
            ),
            "",
        )
        task_entries.append(
            {
                "task_id": task_id,
                "role": task_roles.get(task_id) or None,
                "execution_brief_present": bool(execution_brief_message),
                "execution_brief_path": "/workspace/context/execution-brief.json",
                "execution_brief_excerpt": truncate(execution_brief_message, 400) if execution_brief_message else None,
                "execution_brief_hash": None,
                "execution_brief_refresh_key": None,
                "execution_brief_current_focus": None,
                "execution_brief_predecessor_handoff_id": None,
                "execution_brief_memory_ref_keys": None,
                "execution_brief_artifact_paths": None,
                "system_prompt_contains_workflow_brief": any(
                    "## Workflow Brief" in message for message in system_messages
                ),
                "system_prompt_contains_current_focus": any(
                    "## Current Focus" in message for message in system_messages
                ),
                "system_prompt_contains_predecessor_context": any(
                    "## Predecessor Context" in message for message in system_messages
                ),
                "source": "llm.chat_stream.started",
            }
        )
        seen_task_ids.add(task_id)

    return {
        "task_count": len(task_entries),
        "tasks": task_entries,
    }


def execution_log_rows(logs: Any) -> list[dict[str, Any]]:
    if isinstance(logs, list):
        return [row for row in logs if isinstance(row, dict)]
    if isinstance(logs, dict):
        rows = logs.get("data", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def emit_run_result(payload: dict[str, Any]) -> None:
    serialized = json.dumps(payload)
    output_path = env("LIVE_TEST_SCENARIO_RUN_TMP_FILE", "")
    if output_path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(serialized, encoding="utf-8")
        return
    print(serialized)

__all__ = [name for name in globals() if not name.startswith("__")]
