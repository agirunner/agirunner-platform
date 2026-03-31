#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk07b import *

def evaluate_expectations_preflight(
    expectations: dict[str, Any],
    *,
    workflow: dict[str, Any],
    board: Any,
    work_items: Any,
    stage_gates: Any | None = None,
    workspace: dict[str, Any],
    artifacts: Any,
    approval_actions: list[dict[str, Any]],
    events: Any | None = None,
    fleet: Any | None = None,
    playbook_id: str = "",
    fleet_peaks: dict[str, int] | None = None,
    efficiency: dict[str, Any] | None = None,
    execution_logs: Any | None = None,
    evidence: dict[str, Any] | None = None,
    verification_mode: str = STRICT_VERIFICATION_MODE,
    capability_expectations: dict[str, Any] | None = None,
    capability_setup: dict[str, Any] | None = None,
    capability_proof: dict[str, Any] | None = None,
) -> dict[str, Any]:
    failures: list[str] = []
    required_failures: list[str] = []
    checks: list[dict[str, Any]] = []
    evidence_payload = {} if evidence is None else evidence

    expected_state = expectations.get("state")
    if expected_state is not None:
        actual_state = workflow.get("state")
        passed = actual_state == expected_state
        checks.append({"name": "workflow.state", "passed": passed, "expected": expected_state, "actual": actual_state})
        if not passed:
            failures.append(f"expected workflow state {expected_state!r}, got {actual_state!r}")

    workflow_field_expectations = expectations.get("workflow_fields", {})
    if isinstance(workflow_field_expectations, dict):
        for field_name, expected_value in workflow_field_expectations.items():
            actual_value = workflow.get(field_name)
            passed = actual_value == expected_value
            checks.append(
                {
                    "name": f"workflow_fields.{field_name}",
                    "passed": passed,
                    "expected": expected_value,
                    "actual": actual_value,
                }
            )
            if not passed:
                failures.append(
                    f"expected workflow field {field_name!r} to equal {expected_value!r}, got {actual_value!r}"
                )

    work_item_expectations = expectations.get("work_items", {})
    if isinstance(work_item_expectations, dict) and work_item_expectations.get("all_terminal"):
        items = _work_items(work_items)
        non_terminal = [item.get("id") for item in items if not _work_item_is_terminal(item, board)]
        passed = len(non_terminal) == 0
        checks.append({"name": "work_items.all_terminal", "passed": passed, "non_terminal_ids": non_terminal})
        if not passed:
            failures.append(f"expected all work items to be terminal, found non-terminal items: {non_terminal}")
    if isinstance(work_item_expectations, dict) and "min_count" in work_item_expectations:
        items = _work_items(work_items)
        minimum = int(work_item_expectations["min_count"])
        actual = len(items)
        passed = actual >= minimum
        checks.append(
            {
                "name": "work_items.min_count",
                "passed": passed,
                "expected_min_count": minimum,
                "actual_count": actual,
            }
        )
        if not passed:
            failures.append(f"expected at least {minimum} work items, found {actual}")

    work_item_matches = expectations.get("work_item_matches", [])
    if isinstance(work_item_matches, list):
        items = _work_items(work_items)
        for entry in work_item_matches:
            if not isinstance(entry, dict):
                continue
            match = entry.get("match", {})
            field_expectations = entry.get("field_expectations", {})
            if not isinstance(match, dict) or not isinstance(field_expectations, dict):
                continue
            matches = _find_matching_entries(items, match)
            passed = len(matches) > 0 and any(
                _matches_field_expectations(item, field_expectations) for item in matches
            )
            checks.append({"name": f"work_item_matches:{match}", "passed": passed})
            if not passed:
                failures.append(
                    f"expected work item matching {match!r} with fields {field_expectations!r}"
                )

    stage_gate_matches = expectations.get("stage_gate_matches", [])
    if isinstance(stage_gate_matches, list):
        gates = _stage_gates(stage_gates)
        for entry in stage_gate_matches:
            if not isinstance(entry, dict):
                continue
            match = entry.get("match", {})
            field_expectations = entry.get("field_expectations", {})
            if not isinstance(match, dict) or not isinstance(field_expectations, dict):
                continue
            matches = _find_matching_entries(gates, match)
            passed = len(matches) > 0 and any(
                _matches_field_expectations(item, field_expectations) for item in matches
            )
            checks.append({"name": f"stage_gate_matches:{match}", "passed": passed})
            if not passed:
                failures.append(
                    f"expected stage gate matching {match!r} with fields {field_expectations!r}"
                )

    board_expectations = expectations.get("board", {})
    if isinstance(board_expectations, dict) and "blocked_count" in board_expectations:
        blocked_items = _count_blocked_board_items(board)
        expected_blocked_count = int(board_expectations["blocked_count"])
        passed = blocked_items == expected_blocked_count
        checks.append(
            {
                "name": "board.blocked_count",
                "passed": passed,
                "expected": expected_blocked_count,
                "actual": blocked_items,
            }
        )
        if not passed:
            failures.append(f"expected blocked_count={expected_blocked_count}, got {blocked_items}")

    memory_expectations = expectations.get("memory", [])
    if isinstance(memory_expectations, list):
        memory = workspace.get("memory", {})
        if not isinstance(memory, dict):
            memory = {}
        for entry in memory_expectations:
            if not isinstance(entry, dict):
                continue
            key = entry.get("key")
            if not isinstance(key, str) or key.strip() == "":
                continue
            expected_value = entry.get("value")
            actual_value = memory.get(key)
            passed = key in memory and (expected_value is None or actual_value == expected_value)
            checks.append(
                {
                    "name": f"memory.{key}",
                    "passed": passed,
                    "expected": expected_value,
                    "actual": actual_value,
                }
            )
            if not passed:
                failures.append(f"expected workspace memory key {key!r} with value {expected_value!r}, got {actual_value!r}")

    artifact_expectations = expectations.get("artifacts", [])
    if isinstance(artifact_expectations, list):
        items = _artifacts(artifacts)
        for entry in artifact_expectations:
            if not isinstance(entry, dict):
                continue
            pattern = entry.get("logical_path_pattern") or entry.get("name_pattern")
            if not isinstance(pattern, str) or pattern.strip() == "":
                continue
            minimum = int(entry.get("min_count", 1))
            matches = [
                item
                for item in items
                if isinstance(item, dict) and re.search(pattern, str(item.get("logical_path") or item.get("file_name") or ""))
            ]
            passed = len(matches) >= minimum
            checks.append(
                {
                    "name": f"artifacts:{pattern}",
                    "passed": passed,
                    "expected_min_count": minimum,
                    "actual_count": len(matches),
                }
            )
            if not passed:
                failures.append(
                    f"expected at least {minimum} artifacts matching {pattern!r}, found {len(matches)}"
                )

    host_file_expectations = expectations.get("host_files", [])
    if isinstance(host_file_expectations, list):
        host_root = _workspace_host_directory_root(workspace)
        for entry in host_file_expectations:
            if not isinstance(entry, dict):
                continue
            relative_path = entry.get("path")
            if not isinstance(relative_path, str) or relative_path.strip() == "":
                continue
            check_name = f"host_files.{relative_path}"
            if host_root is None:
                checks.append({"name": check_name, "passed": False, "reason": "host_directory_root_missing"})
                failures.append("expected host-directory workspace settings with a host_path for host_files checks")
                continue
            target = host_root / relative_path
            exists = target.is_file()
            passed = exists
            actual_content = None
            if exists and "contains" in entry:
                actual_content = target.read_text(encoding="utf-8")
                passed = str(entry["contains"]) in actual_content
            checks.append(
                {
                    "name": check_name,
                    "passed": passed,
                    "path": str(target),
                }
            )
            if not exists:
                failures.append(f"expected host file {target} to exist")
            elif "contains" in entry and not passed:
                failures.append(f"expected host file {target} to contain {entry['contains']!r}")

    workflow_task_expectations = expectations.get("workflow_tasks", {})
    if isinstance(workflow_task_expectations, dict):
        workflow_tasks = [task for task in _workflow_tasks(workflow) if isinstance(task, dict)]
        non_orchestrator_tasks = [
            task for task in workflow_tasks if not bool(task.get("is_orchestrator_task"))
        ]
        if "min_non_orchestrator_count" in workflow_task_expectations:
            minimum = int(workflow_task_expectations["min_non_orchestrator_count"])
            actual = len(non_orchestrator_tasks)
            passed = actual >= minimum
            checks.append(
                {
                    "name": "workflow_tasks.min_non_orchestrator_count",
                    "passed": passed,
                    "expected_min_count": minimum,
                    "actual_count": actual,
                }
            )
            if not passed:
                failures.append(f"expected at least {minimum} non-orchestrator tasks, found {actual}")
        forbidden_task_kinds = sorted(
            {
                item.strip()
                for item in workflow_task_expectations.get("forbid_task_kinds", [])
                if isinstance(item, str) and item.strip() != ""
            }
        )
        if forbidden_task_kinds:
            actual_forbidden = sorted(
                {
                    task_kind
                    for task in non_orchestrator_tasks
                    for task_kind in [_task_kind(task)]
                    if task_kind in forbidden_task_kinds
                }
            )
            passed = len(actual_forbidden) == 0
            checks.append(
                {
                    "name": "workflow_tasks.forbid_task_kinds",
                    "passed": passed,
                    "expected_forbidden": forbidden_task_kinds,
                    "actual_forbidden": actual_forbidden,
                }
            )
            if not passed:
                failures.append(
                    f"expected workflow to avoid task kinds {forbidden_task_kinds}, found {actual_forbidden}"
                )

    workflow_tasks = [task for task in _workflow_tasks(workflow) if isinstance(task, dict)]

    task_backend_expectations = expectations.get("task_backend_expectations", [])
    if isinstance(task_backend_expectations, list):
        for entry in task_backend_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_task_backend_expectation(entry, workflow_tasks=workflow_tasks)
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    structured_breakout_expectations = expectations.get("structured_breakout_expectations", [])
    if isinstance(structured_breakout_expectations, list):
        for entry in structured_breakout_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_structured_breakout_expectation(
                entry,
                workflow_tasks=workflow_tasks,
                work_items_snapshot=work_items,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    log_row_expectations = expectations.get("log_row_expectations", [])
    if isinstance(log_row_expectations, list):
        log_rows = execution_log_rows(execution_logs)
        for entry in log_row_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_log_row_expectation(entry, log_rows=log_rows)
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    container_observation_expectations = expectations.get("container_observation_expectations", [])
    if isinstance(container_observation_expectations, list):
        observed_rows = container_observation_rows(evidence_payload.get("container_observations"))
        for entry in container_observation_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_container_observation_expectation(
                entry,
                observed_rows=observed_rows,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    evidence_expectations = expectations.get("evidence_expectations", {})
    if isinstance(evidence_expectations, dict):
        if "db_state_present" in evidence_expectations:
            passed = bool((evidence_payload.get("db_state") or {}).get("ok")) is bool(
                evidence_expectations["db_state_present"]
            )
            checks.append({"name": "evidence_expectations.db_state_present", "passed": passed})
            if not passed:
                failures.append("expected DB evidence to be present")
        if "runtime_cleanup_passed" in evidence_expectations:
            passed = bool((evidence_payload.get("runtime_cleanup") or {}).get("all_clean")) is bool(
                evidence_expectations["runtime_cleanup_passed"]
            )
            checks.append({"name": "evidence_expectations.runtime_cleanup_passed", "passed": passed})
            if not passed:
                failures.append("expected runtime cleanup evidence to pass")
        if "docker_log_rotation_passed" in evidence_expectations:
            passed = bool(
                (evidence_payload.get("docker_log_rotation") or {}).get("all_runtime_containers_bounded")
            ) is bool(evidence_expectations["docker_log_rotation_passed"])
            checks.append({"name": "evidence_expectations.docker_log_rotation_passed", "passed": passed})
            if not passed:
                failures.append("expected Docker log rotation evidence to pass")
        if "log_anomalies_empty" in evidence_expectations:
            anomalies = evidence_payload.get("log_anomalies", {})
            passed = len(anomalies.get("rows", [])) == 0 if isinstance(anomalies, dict) else False
            passed = passed is bool(evidence_expectations["log_anomalies_empty"])
            checks.append({"name": "evidence_expectations.log_anomalies_empty", "passed": passed})
            if not passed:
                failures.append("expected execution-log anomaly review to be empty")
        if "distinct_orchestrator_runtime_count_min" in evidence_expectations:
            minimum = evidence_expectations["distinct_orchestrator_runtime_count_min"]
            actual = len(_distinct_orchestrator_runtime_actors(execution_logs))
            passed = isinstance(minimum, int) and actual >= minimum
            checks.append(
                {
                    "name": "evidence_expectations.distinct_orchestrator_runtime_count_min",
                    "passed": passed,
                    "expected_min": minimum,
                    "actual": actual,
                }
            )
            if not passed:
                failures.append(
                    f"expected at least {minimum} distinct orchestrator runtime actor(s), found {actual}"
                )

    capability_result = evaluate_capability_expectations(
        expectations={} if capability_expectations is None else capability_expectations,
        setup={} if capability_setup is None else capability_setup,
        proof={} if capability_proof is None else capability_proof,
    )
    if capability_expectations:
        checks.append(
            {
                "name": "capabilities",
                "passed": capability_result["passed"],
                "failures": capability_result["failures"],
            }
        )
        failures.extend(capability_result["failures"])
        required_failures.extend(capability_result["failures"])

    return {
        "failures": failures,
        "required_failures": required_failures,
        "checks": checks,
        "evidence_payload": evidence_payload,
        "workflow_tasks": _workflow_tasks(workflow),
        "capability_result": capability_result,
        "events": events,
        "fleet": fleet,
        "playbook_id": playbook_id,
        "fleet_peaks": fleet_peaks,
        "efficiency": efficiency,
        "execution_logs": execution_logs,
        "verification_mode": verification_mode,
        "expectations": expectations,
        "workflow": workflow,
        "board": board,
        "work_items": work_items,
        "stage_gates": stage_gates,
        "workspace": workspace,
        "artifacts": artifacts,
        "approval_actions": approval_actions,
        "capability_expectations": capability_expectations,
        "capability_setup": capability_setup,
        "capability_proof": capability_proof,
    }

__all__ = [name for name in globals() if not name.startswith("__")]
