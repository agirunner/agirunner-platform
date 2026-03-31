#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk12 import *

def main() -> None:
    base_url = env("PLATFORM_API_BASE_URL", required=True)
    trace_dir = env("LIVE_TEST_SCENARIO_TRACE_DIR", required=True)
    admin_api_key = env("DEFAULT_ADMIN_API_KEY", required=True)
    bootstrap_context_file = env("LIVE_TEST_BOOTSTRAP_CONTEXT_FILE", required=True)
    scenario_file = env("LIVE_TEST_SCENARIO_FILE")
    scenario = load_scenario(scenario_file) if scenario_file else None
    workflow_name = scenario["workflow"]["name"] if scenario else env("LIVE_TEST_WORKFLOW_NAME", required=True)
    workflow_goal = scenario["workflow"]["goal"] if scenario else env("LIVE_TEST_WORKFLOW_GOAL", required=True)
    scenario_name = scenario["name"] if scenario else env("LIVE_TEST_SCENARIO_NAME", required=True)
    approval_mode = "scripted" if scenario and scenario["approvals"] else env("LIVE_TEST_APPROVAL_MODE", "none")
    verification_mode = env("LIVE_TEST_VERIFICATION_MODE", OUTCOME_DRIVEN_VERIFICATION_MODE)
    timeout_seconds = scenario["timeout_seconds"] if scenario else env_int("LIVE_TEST_WORKFLOW_TIMEOUT_SECONDS", 1800)
    poll_interval_seconds = scenario["poll_interval_seconds"] if scenario else env_int("LIVE_TEST_POLL_INTERVAL_SECONDS", 10)

    bootstrap_context = read_json(bootstrap_context_file)
    workspace_id = env("LIVE_TEST_WORKSPACE_ID", bootstrap_context["workspace_id"], required=True)
    playbook_id = env("LIVE_TEST_PLAYBOOK_ID", bootstrap_context["playbook_id"], required=True)
    playbook_launch_inputs = normalize_playbook_launch_inputs(bootstrap_context.get("playbook_launch_inputs"))
    capability_setup = {
        "skills": bootstrap_context.get("profile_skills", []),
        "remote_mcp_servers": bootstrap_context.get("profile_remote_mcp_servers", []),
        "roles": bootstrap_context.get("profile_roles", []),
    }
    selected_execution_environment = (
        dict(bootstrap_context["default_execution_environment"])
        if isinstance(bootstrap_context.get("default_execution_environment"), dict)
        else None
    )
    tenant_default_execution_environment = (
        dict(bootstrap_context["tenant_default_execution_environment"])
        if isinstance(bootstrap_context.get("tenant_default_execution_environment"), dict)
        else None
    )
    execution_environment_expectations = {
        "selected_default_environment_id": None
        if selected_execution_environment is None
        else selected_execution_environment.get("id"),
        "tenant_default_environment_id": None
        if tenant_default_execution_environment is None
        else tenant_default_execution_environment.get("id"),
        "roles": bootstrap_context.get("profile_roles", []),
    }
    provider_auth_mode = env(
        "LIVE_TEST_PROVIDER_AUTH_MODE",
        str(bootstrap_context.get("provider_auth_mode") or "").strip(),
        required=True,
    )
    final_settle_attempts = env_int("LIVE_TEST_FINAL_SETTLE_ATTEMPTS", DEFAULT_FINAL_SETTLE_ATTEMPTS)
    final_settle_delay_seconds = env_int(
        "LIVE_TEST_FINAL_SETTLE_DELAY_SECONDS",
        DEFAULT_FINAL_SETTLE_DELAY_SECONDS,
    )
    action_plan = [] if scenario is None else scenario["actions"]
    expectation_plan = {} if scenario is None else scenario["expect"]
    capability_expectation_plan = {} if scenario is None else scenario["capabilities"]
    initial_remote_mcp_fixture_snapshot = capture_remote_mcp_fixture_snapshot()

    trace = TraceRecorder(trace_dir)
    public_client = ApiClient(base_url, trace)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token, lambda: login(public_client, admin_api_key))

    created = extract_data(
        client.request(
            "POST",
            "/api/v1/workflows",
            payload=build_workflow_create_payload(
                playbook_id=playbook_id,
                workspace_id=workspace_id,
                workflow_name=workflow_name,
                scenario_name=scenario_name,
                workflow_goal=workflow_goal,
                playbook_launch_inputs=playbook_launch_inputs,
                workflow_parameters={} if scenario is None else scenario["workflow"]["parameters"],
                workflow_metadata={} if scenario is None else scenario["workflow"]["metadata"],
                execution_environment=selected_execution_environment,
            ),
            expected=(201,),
            label="workflows.create",
        )
    )

    workflow_id = created["id"]
    next_action_index, workflow_actions = dispatch_ready_workflow_actions(
        client,
        workflow_id=workflow_id,
        scenario_name=scenario_name,
        actions=action_plan,
        next_action_index=0,
        workflow=created,
        work_items_snapshot={"ok": True, "data": []},
        board_snapshot={"ok": True, "data": {"columns": [], "work_items": []}},
    )
    deadline = time.time() + timeout_seconds
    latest_workflow = created
    latest_approvals: dict[str, Any] | None = None
    poll_iterations = 0
    timed_out = True
    approved_gate_ids: set[str] = set()
    approval_actions: list[dict[str, Any]] = []
    consumed_decisions: set[int] = set()
    fleet_peaks: dict[str, int] = {
        "peak_running": 0,
        "peak_executing": 0,
        "peak_active_workflows": 0,
    }
    latest_fleet: Any = {}
    live_container_observations = new_container_observations()
    latest_live_containers: Any = {"ok": False, "error": "not_collected"}

    while time.time() < deadline:
        poll_iterations += 1
        latest_workflow = extract_data(
            client.request(
                "GET",
                f"/api/v1/workflows/{workflow_id}",
                expected=(200,),
                label="workflows.get",
            )
        )

        work_items_for_actions = None
        board_for_actions = None
        if next_action_index < len(action_plan):
            board_for_actions = client.best_effort_request(
                "GET",
                f"/api/v1/workflows/{workflow_id}/board",
                expected=(200,),
                label="workflows.board.actions",
            )
            work_items_for_actions = client.best_effort_request(
                "GET",
                f"/api/v1/workflows/{workflow_id}/work-items",
                expected=(200,),
                label="workflows.work-items.actions",
            )
            next_action_index, ready_actions = dispatch_ready_workflow_actions(
                client,
                workflow_id=workflow_id,
                scenario_name=scenario_name,
                actions=action_plan,
                next_action_index=next_action_index,
                workflow=latest_workflow,
                work_items_snapshot=work_items_for_actions,
                board_snapshot=board_for_actions,
            )
            if ready_actions:
                workflow_actions.extend(ready_actions)
                continue

        if latest_workflow.get("state") in TERMINAL_STATES:
            timed_out = False
            break
        latest_fleet = client.best_effort_request(
            "GET",
            "/api/v1/fleet/status",
            expected=(200,),
            label="fleet.status",
        )
        if latest_fleet.get("ok"):
            update_fleet_peaks(fleet_peaks, latest_fleet.get("data"), playbook_id=playbook_id)
        latest_live_containers = collect_live_container_snapshot(client, label="containers.list.progress")
        if latest_live_containers.get("ok"):
            observe_live_containers(live_container_observations, latest_live_containers.get("data"))
        latest_approvals = extract_data(
            client.request(
                "GET",
                "/api/v1/approvals",
                expected=(200,),
                label="approvals.list",
            )
        )
        actions = process_workflow_approvals(
            client,
            latest_approvals,
            workflow_id=workflow_id,
            scenario_name=scenario_name,
            approved_gate_ids=approved_gate_ids,
            approval_mode=approval_mode,
            consumed_decisions=consumed_decisions,
            approval_decisions=[] if scenario is None else scenario["approvals"],
        )
        if actions:
            approval_actions.extend(actions)
            continue

        if (
            next_action_index == len(action_plan)
            and latest_workflow.get("state") not in TERMINAL_STATES
            and expectation_plan.get("state") not in TERMINAL_STATES
        ):
            board_snapshot = client.best_effort_request(
                "GET",
                f"/api/v1/workflows/{workflow_id}/board",
                expected=(200,),
                label="workflows.board.progress",
            )
            work_items_snapshot = (
                work_items_for_actions
                if work_items_for_actions is not None
                else client.best_effort_request(
                    "GET",
                    f"/api/v1/workflows/{workflow_id}/work-items",
                    expected=(200,),
                    label="workflows.work-items.progress",
                )
            )
            stage_gates_snapshot = collect_workflow_stage_gates(client, workflow_id=workflow_id)
            workspace_snapshot = extract_data(
                client.request(
                    "GET",
                    f"/api/v1/workspaces/{workspace_id}",
                    expected=(200,),
                    label="workspaces.get.progress",
                )
            )
            artifacts_snapshot = client.best_effort_request(
                "GET",
                f"/api/v1/workspaces/{workspace_id}/artifacts",
                expected=(200,),
                label="workspaces.artifacts.progress",
            )
            progress_verification = evaluate_progress_expectations(
                client,
                workflow_id=workflow_id,
                expectations=expectation_plan,
                workflow=latest_workflow,
                board=board_snapshot,
                work_items=work_items_snapshot,
                stage_gates=stage_gates_snapshot,
                workspace=workspace_snapshot,
                artifacts=artifacts_snapshot,
                approval_actions=approval_actions,
                fleet=latest_fleet,
                playbook_id=playbook_id,
            fleet_peaks=fleet_peaks,
            verification_mode=verification_mode,
            trace=trace,
            execution_environment_expectations=execution_environment_expectations,
            capability_expectations=capability_expectation_plan,
            capability_setup=capability_setup,
        )
            if progress_verification_can_end_run(
                progress_verification,
                workflow=attach_workflow_tasks(
                    latest_workflow,
                    fetch_workflow_tasks(client, workflow_id=workflow_id),
                ),
                verification_mode=verification_mode,
            ):
                timed_out = False
                break
        time.sleep(poll_interval_seconds)

    latest_workflow = refresh_terminal_workflow_snapshot(
        client,
        workflow_id=workflow_id,
        workflow=latest_workflow,
        max_attempts=final_settle_attempts,
        delay_seconds=final_settle_delay_seconds,
    )
    latest_workflow = attach_workflow_tasks(
        latest_workflow,
        fetch_workflow_tasks(client, workflow_id=workflow_id),
    )

    board_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/board",
        expected=(200,),
        label="workflows.board",
    )
    work_items_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/work-items",
        expected=(200,),
        label="workflows.work-items",
    )
    stage_gates_snapshot = collect_workflow_stage_gates(client, workflow_id=workflow_id)
    events_snapshot = collect_workflow_events(client, workflow_id=workflow_id)
    approvals_snapshot = client.best_effort_request(
        "GET",
        "/api/v1/approvals",
        expected=(200,),
        label="approvals.final",
    )
    workspace_snapshot = extract_data(
        client.request(
            "GET",
            f"/api/v1/workspaces/{workspace_id}",
            expected=(200,),
            label="workspaces.get",
        )
    )
    artifacts_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workspaces/{workspace_id}/artifacts",
        expected=(200,),
        label="workspaces.artifacts",
    )
    latest_fleet = client.best_effort_request(
        "GET",
        "/api/v1/fleet/status",
        expected=(200,),
        label="fleet.status.final",
    )
    if latest_fleet.get("ok"):
        update_fleet_peaks(fleet_peaks, latest_fleet.get("data"), playbook_id=playbook_id)
    latest_live_containers, runtime_cleanup_evidence, docker_log_rotation_evidence = settle_final_live_container_evidence(
        client,
        max_attempts=final_settle_attempts,
        delay_seconds=final_settle_delay_seconds,
        trace=trace,
        live_container_observations=live_container_observations,
        relevant_task_ids=_workflow_task_ids(latest_workflow),
    )
    db_state_snapshot = collect_db_state_snapshot(trace, workflow_id=workflow_id)
    execution_logs_snapshot, workspace_scope_trace = collect_consistent_workspace_scope_evidence(
        client,
        workflow_id=workflow_id,
        workflow=latest_workflow,
        db_state_snapshot=db_state_snapshot,
    )
    efficiency_summary = summarize_efficiency(
        workflow=latest_workflow,
        logs=execution_logs_snapshot,
        events=events_snapshot,
        approval_actions=approval_actions,
    )
    evidence_payload = {
        "db_state": db_state_snapshot,
        "execution_environment_usage": summarize_execution_environment_usage(
            execution_environment_expectations,
            db_state_snapshot,
        ),
        "log_anomalies": summarize_log_anomalies(execution_logs_snapshot),
        "http_status_summary": summarize_http_status_anomalies(execution_logs_snapshot),
        "live_containers": latest_live_containers,
        "container_observations": finalize_container_observations(live_container_observations),
        "runtime_cleanup": runtime_cleanup_evidence,
        "docker_log_rotation": docker_log_rotation_evidence,
        "workspace_scope_trace": workspace_scope_trace,
    }
    remote_mcp_fixture_activity = summarize_remote_mcp_fixture_activity(
        before_snapshot=initial_remote_mcp_fixture_snapshot,
        after_snapshot=capture_remote_mcp_fixture_snapshot(),
        capability_setup=capability_setup,
    )
    evidence_payload["remote_mcp_fixture"] = remote_mcp_fixture_activity
    capability_proof = merge_remote_mcp_fixture_into_capability_proof(
        build_capability_proof(workflow=latest_workflow, logs=execution_logs_snapshot),
        remote_mcp_fixture_activity,
    )
    evidence_payload["capability_proof"] = capability_proof
    final_state = latest_workflow.get("state")
    verification = evaluate_expectations(
        expectation_plan,
        workflow=latest_workflow,
        board=board_snapshot,
        work_items=work_items_snapshot,
        stage_gates=stage_gates_snapshot,
        workspace=workspace_snapshot,
        artifacts=artifacts_snapshot,
        approval_actions=approval_actions,
        events=events_snapshot,
        fleet=latest_fleet,
        playbook_id=playbook_id,
        fleet_peaks=fleet_peaks,
        efficiency=efficiency_summary,
        execution_logs=execution_logs_snapshot,
        evidence=evidence_payload,
        verification_mode=verification_mode,
        capability_expectations=capability_expectation_plan,
        capability_setup=capability_setup,
        capability_proof=capability_proof,
    )
    evidence_payload["scenario_outcome_metrics"] = build_scenario_outcome_metrics(
        final_state=final_state,
        verification=verification,
        workflow=latest_workflow,
        board=board_snapshot,
        work_items=work_items_snapshot,
        stage_gates=stage_gates_snapshot,
        artifacts=artifacts_snapshot,
        approval_actions=approval_actions,
        workflow_actions=workflow_actions,
        execution_logs=execution_logs_snapshot,
        evidence=evidence_payload,
    )
    evidence_payload["artifacts"] = write_evidence_artifacts(trace_dir, evidence_payload)
    emit_run_result(
        build_run_result_payload(
            workflow_id=workflow_id,
            final_state=final_state,
            timed_out=timed_out,
            poll_iterations=poll_iterations,
            scenario_name=scenario_name,
            approval_mode=approval_mode,
            provider_auth_mode=provider_auth_mode,
            verification_mode=verification_mode,
            workflow=latest_workflow,
            board=board_snapshot,
            work_items=work_items_snapshot,
            stage_gates=stage_gates_snapshot,
            events=events_snapshot,
            approvals=approvals_snapshot,
            approval_actions=approval_actions,
            workflow_actions=workflow_actions,
            workspace=workspace_snapshot,
            artifacts=artifacts_snapshot,
            fleet=latest_fleet,
            fleet_peaks=fleet_peaks,
            execution_logs=execution_logs_snapshot,
            efficiency=efficiency_summary,
            verification=verification,
        evidence=evidence_payload,
        execution_environment=selected_execution_environment,
        capability_proof=capability_proof,
    )
    )
    if not verification["passed"]:
        raise SystemExit(1)

__all__ = [name for name in globals() if not name.startswith("__")]
