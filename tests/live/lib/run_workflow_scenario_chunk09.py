#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk08 import *


def evaluate_expectations(
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
    preflight = evaluate_expectations_preflight(
        expectations,
        workflow=workflow,
        board=board,
        work_items=work_items,
        stage_gates=stage_gates,
        workspace=workspace,
        artifacts=artifacts,
        approval_actions=approval_actions,
        events=events,
        fleet=fleet,
        playbook_id=playbook_id,
        fleet_peaks=fleet_peaks,
        efficiency=efficiency,
        execution_logs=execution_logs,
        evidence=evidence,
        verification_mode=verification_mode,
        capability_expectations=capability_expectations,
        capability_setup=capability_setup,
        capability_proof=capability_proof,
    )
    failures = preflight["failures"]
    required_failures = preflight["required_failures"]
    checks = preflight["checks"]
    evidence_payload = preflight["evidence_payload"]
    workflow_tasks = preflight["workflow_tasks"]
    capability_result = preflight["capability_result"]
    events = preflight["events"]
    fleet = preflight["fleet"]
    playbook_id = preflight["playbook_id"]
    fleet_peaks = preflight["fleet_peaks"]
    efficiency = preflight["efficiency"]
    execution_logs = preflight["execution_logs"]
    verification_mode = preflight["verification_mode"]
    expectations = preflight["expectations"]
    workflow = preflight["workflow"]
    board = preflight["board"]
    work_items = preflight["work_items"]
    stage_gates = preflight["stage_gates"]
    workspace = preflight["workspace"]
    artifacts = preflight["artifacts"]
    approval_actions = preflight["approval_actions"]
    capability_expectations = preflight["capability_expectations"]
    capability_setup = preflight["capability_setup"]
    capability_proof = preflight["capability_proof"]
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

    fleet_expectations = expectations.get("fleet", {})
    if isinstance(fleet_expectations, dict):
        pool_expectations = fleet_expectations.get("playbook_pool", {})
        if isinstance(pool_expectations, dict) and pool_expectations:
            pool = _playbook_pool_status(fleet, playbook_id=playbook_id)
            requires_current_pool = _fleet_pool_requires_current_snapshot(pool_expectations)
            if pool is None and requires_current_pool:
                checks.append(
                    {
                        "name": "fleet.playbook_pool.present",
                        "passed": False,
                        "playbook_id": playbook_id,
                    }
                )
                failures.append(f"expected fleet pool entry for playbook {playbook_id!r}")
            else:
                if pool is not None:
                    checks.append(
                        {
                            "name": "fleet.playbook_pool.present",
                            "passed": True,
                            "playbook_id": playbook_id,
                        }
                    )
                for field in ("max_runtimes", "active_workflows"):
                    if field not in pool_expectations:
                        continue
                    expected_value = int(pool_expectations[field])
                    actual_value = int((pool or {}).get(field, 0))
                    passed = actual_value == expected_value
                    checks.append(
                        {
                            "name": f"fleet.playbook_pool.{field}",
                            "passed": passed,
                            "expected": expected_value,
                            "actual": actual_value,
                        }
                    )
                    if not passed:
                        failures.append(
                            f"expected fleet playbook pool {field}={expected_value}, got {actual_value}"
                        )

                peaks = fleet_peaks or {}
                for expectation_key, peak_key in (
                    ("peak_running_lte", "peak_running"),
                    ("peak_executing_lte", "peak_executing"),
                    ("peak_active_workflows_lte", "peak_active_workflows"),
                ):
                    if expectation_key not in pool_expectations:
                        continue
                    expected_max = int(pool_expectations[expectation_key])
                    actual_peak = int(peaks.get(peak_key, 0))
                    passed = actual_peak <= expected_max
                    checks.append(
                        {
                            "name": f"fleet.playbook_pool.{expectation_key}",
                            "passed": passed,
                            "expected_max": expected_max,
                            "actual": actual_peak,
                        }
                    )
                    if not passed:
                        failures.append(
                            f"expected fleet playbook pool {peak_key} <= {expected_max}, got {actual_peak}"
                        )

                for expectation_key, peak_key in (
                    ("peak_running_gte", "peak_running"),
                    ("peak_executing_gte", "peak_executing"),
                    ("peak_active_workflows_gte", "peak_active_workflows"),
                ):
                    if expectation_key not in pool_expectations:
                        continue
                    expected_min = int(pool_expectations[expectation_key])
                    actual_peak = int(peaks.get(peak_key, 0))
                    passed = actual_peak >= expected_min
                    checks.append(
                        {
                            "name": f"fleet.playbook_pool.{expectation_key}",
                            "passed": passed,
                            "expected_min": expected_min,
                            "actual": actual_peak,
                        }
                    )
                    if not passed:
                        failures.append(
                            f"expected fleet playbook pool {peak_key} >= {expected_min}, got {actual_peak}"
                        )

    approval_action_expectations = expectations.get("approval_actions", [])
    if isinstance(approval_action_expectations, list):
        for entry in approval_action_expectations:
            if not isinstance(entry, dict):
                continue
            matched = any(
                all(actual.get(key) == expected for key, expected in entry.items())
                for actual in approval_actions
                if isinstance(actual, dict)
            )
            checks.append({"name": f"approval_actions:{entry}", "passed": matched})
            if not matched:
                failures.append(f"expected approval action {entry!r} was not observed")

    gate_rework_sequences = expectations.get("gate_rework_sequences", [])
    if isinstance(gate_rework_sequences, list):
        event_list = sorted(
            _workflow_events(events),
            key=lambda entry: _parse_timestamp(entry.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        )
        workflow_tasks = _workflow_tasks(workflow)
        for entry in gate_rework_sequences:
            if not isinstance(entry, dict):
                continue
            stage_name = entry.get("stage_name")
            if not isinstance(stage_name, str) or stage_name.strip() == "":
                continue
            rework_stage_name = entry.get("rework_stage_name", stage_name)
            if not isinstance(rework_stage_name, str) or rework_stage_name.strip() == "":
                rework_stage_name = stage_name
            request_action = str(entry.get("request_action", "request_changes"))
            resume_action = str(entry.get("resume_action", "approve"))
            required_event_type = str(entry.get("required_event_type", "task.handoff_submitted"))
            required_role = entry.get("required_role")
            require_non_orchestrator = bool(entry.get("require_non_orchestrator", True))

            request_event = next(
                (
                    actual
                    for actual in event_list
                    if actual.get("type") == f"stage.gate.{request_action}"
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
                    and actual.get("type") == f"stage.gate.{resume_action}"
                    and isinstance(actual.get("data"), dict)
                    and actual["data"].get("stage_name") == stage_name
                ),
                None,
            )
            resume_index = event_list.index(resume_event) if resume_event in event_list else None

            matched = False
            if request_index is not None and resume_index is not None:
                for actual in event_list[request_index + 1 : resume_index]:
                    data = actual.get("data")
                    if not isinstance(data, dict):
                        continue
                    if actual.get("type") != required_event_type:
                        continue
                    if data.get("stage_name") != rework_stage_name:
                        continue
                    role = data.get("role")
                    if require_non_orchestrator and role == "orchestrator":
                        continue
                    if required_role is not None and role != required_role:
                        continue
                    matched = True
                    break
            if not matched and request_event is not None and resume_event is not None:
                request_at = _parse_timestamp(request_event.get("created_at"))
                resume_at = _parse_timestamp(resume_event.get("created_at"))
            else:
                request_at = _approval_action_timestamp(
                    approval_actions,
                    stage_name=stage_name,
                    action=request_action,
                )
                resume_at = _approval_action_timestamp(
                    approval_actions,
                    stage_name=stage_name,
                    action=resume_action,
                    after=request_at,
                )

            if not matched and request_at is not None and resume_at is not None:
                for task in workflow_tasks:
                    if not isinstance(task, dict):
                        continue
                    if task.get("stage_name") != rework_stage_name:
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
                        matched = True
                        break

            check_name = (
                f"gate_rework_sequences:{stage_name}:{request_action}->{required_event_type}->{resume_action}"
            )
            checks.append({"name": check_name, "passed": matched})
            if not matched:
                failures.append(
                    f"expected {required_event_type!r} for rework stage {rework_stage_name!r} after "
                    f"gate stage {stage_name!r} "
                    f"between "
                    f"stage.gate.{request_action} and stage.gate.{resume_action}"
                )

    task_rework_sequences = expectations.get("task_rework_sequences", [])
    if isinstance(task_rework_sequences, list):
        event_list = sorted(
            _workflow_events(events),
            key=lambda entry: _parse_timestamp(entry.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        )
        workflow_tasks = _workflow_tasks(workflow)
        for entry in task_rework_sequences:
            if not isinstance(entry, dict):
                continue
            stage_name = entry.get("stage_name")
            if not isinstance(stage_name, str) or stage_name.strip() == "":
                continue
            request_event_type = str(entry.get("request_event_type", "task.assessment_requested_changes"))
            resume_event_type = str(entry.get("resume_event_type", "task.approved"))
            required_event_type = str(entry.get("required_event_type", "task.handoff_submitted"))
            required_role = entry.get("required_role")
            require_non_orchestrator = bool(entry.get("require_non_orchestrator", True))

            matched = _matches_rework_sequence(
                event_list=event_list,
                workflow_tasks=workflow_tasks,
                stage_name=stage_name,
                request_event_type=request_event_type,
                resume_event_type=resume_event_type,
                required_event_type=required_event_type,
                required_role=required_role,
                require_non_orchestrator=require_non_orchestrator,
            )
            check_name = (
                f"task_rework_sequences:{stage_name}:{request_event_type}->{required_event_type}->{resume_event_type}"
            )
            checks.append({"name": check_name, "passed": matched})
            if not matched:
                failures.append(
                    f"expected specialist rework for stage {stage_name!r} between "
                    f"{request_event_type!r} and {resume_event_type!r}"
                )

    continuity_rework_sequences = expectations.get("continuity_rework_sequences", [])
    if isinstance(continuity_rework_sequences, list):
        workflow_tasks = _workflow_tasks(workflow)
        for entry in continuity_rework_sequences:
            if not isinstance(entry, dict):
                continue
            stage_name = entry.get("stage_name")
            required_role = entry.get("required_role")
            if not isinstance(stage_name, str) or stage_name.strip() == "":
                continue
            if not isinstance(required_role, str) or required_role.strip() == "":
                continue
            minimum_rework_count = int(entry.get("minimum_rework_count", 1))
            assessment_stage_name = str(entry.get("assessment_stage_name", stage_name))
            assessment_task_min_count = int(entry.get("assessment_task_min_count", 1))
            matched = _matches_continuity_rework_sequence(
                work_items_snapshot=work_items,
                execution_logs=execution_logs,
                workflow_tasks=workflow_tasks,
                stage_name=stage_name,
                required_role=required_role,
                minimum_rework_count=minimum_rework_count,
                assessment_stage_name=assessment_stage_name,
                assessment_task_min_count=assessment_task_min_count,
            )
            check_name = f"continuity_rework_sequences:{stage_name}:{required_role}"
            checks.append({"name": check_name, "passed": matched})
            if not matched:
                failures.append(
                    f"expected continuity-backed rework for stage {stage_name!r} "
                    f"with role {required_role!r}"
                )

    workflow_tasks = _workflow_tasks(workflow)

    direct_handoff_expectations = expectations.get("direct_handoff_expectations", [])
    if isinstance(direct_handoff_expectations, list):
        for entry in direct_handoff_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_direct_handoff_expectation(
                entry,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    assessment_sequences = expectations.get("assessment_sequences", [])
    if isinstance(assessment_sequences, list):
        for entry in assessment_sequences:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_assessment_sequence(
                entry,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    approval_sequences = expectations.get("approval_sequences", [])
    if isinstance(approval_sequences, list):
        for entry in approval_sequences:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_approval_sequence(
                entry,
                approval_actions=approval_actions,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    approval_before_assessment_sequences = expectations.get("approval_before_assessment_sequences", [])
    if isinstance(approval_before_assessment_sequences, list):
        for entry in approval_before_assessment_sequences:
            if not isinstance(entry, dict):
                continue
            match = entry.get("match", {})
            if not isinstance(match, dict) or not match:
                continue
            assessed_by = entry.get("assessed_by")
            if not isinstance(assessed_by, str) or assessed_by.strip() == "":
                continue
            approval_action = str(entry.get("approval_action", "approve"))
            assessment_stage_name = entry.get("assessment_stage_name")
            approval_times = [
                _parse_timestamp(action.get("submitted_at"))
                for action in approval_actions
                if isinstance(action, dict)
                and action.get("action") == approval_action
                and _matches_field_expectations(action, match)
            ]
            approval_times = [value for value in approval_times if value is not None]
            assessment_times = [
                _task_timestamp(task)
                for task in workflow_tasks
                if isinstance(task, dict)
                and _task_kind(task) == "assessment"
                and task.get("role") == assessed_by.strip()
                and (
                    not isinstance(assessment_stage_name, str)
                    or assessment_stage_name.strip() == ""
                    or task.get("stage_name") == assessment_stage_name.strip()
                )
            ]
            assessment_times = [value for value in assessment_times if value is not None]
            passed = bool(approval_times) and bool(assessment_times) and min(approval_times) <= min(assessment_times)
            checks.append(
                {
                    "name": f"approval_before_assessment_sequences:{match}:{assessed_by.strip()}",
                    "passed": passed,
                }
            )
            if not passed:
                failures.append(
                    f"expected approval {approval_action!r} for {match!r} before assessment role {assessed_by.strip()!r}"
                )

    subject_revision_expectations = expectations.get("subject_revision_expectations", [])
    if isinstance(subject_revision_expectations, list):
        for entry in subject_revision_expectations:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_subject_revision_expectation(
                entry,
                work_items_snapshot=work_items,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    required_assessment_sets = expectations.get("required_assessment_sets", [])
    if isinstance(required_assessment_sets, list):
        for entry in required_assessment_sets:
            if not isinstance(entry, dict):
                continue
            check, failure = _evaluate_required_assessment_set(
                entry,
                workflow_tasks=workflow_tasks,
            )
            checks.append(check)
            if failure is not None:
                failures.append(failure)

    return finalize_expectations_result(
        expectations=expectations,
        workflow=workflow,
        work_items=work_items,
        board=board,
        artifacts=artifacts,
        evidence_payload=evidence_payload,
        execution_logs=execution_logs,
        efficiency=efficiency,
        verification_mode=verification_mode,
        approval_actions=approval_actions,
        failures=failures,
        required_failures=required_failures,
        checks=checks,
    )

__all__ = [name for name in globals() if not name.startswith("__")]
