#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
import os
import json
from pathlib import Path
from unittest import mock


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import run_workflow_scenario  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], tuple[int, ...], str | None]] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, object]:
        self.calls.append((method, path, payload or {}, expected, label))
        action = (payload or {}).get("action", "approve")
        status = "blocked" if action == "block" else "approved"
        return {"data": {"gate_id": path.rsplit("/", 1)[-1], "status": status}}


class FakePagedClient:
    def __init__(self, responses: list[dict[str, object]]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict[str, object] | None, tuple[int, ...], str | None]] = []

    def best_effort_request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, object]:
        self.calls.append((method, path, payload, expected, label))
        if not self.responses:
            raise AssertionError(f"unexpected request: {method} {path}")
        return self.responses.pop(0)


class FakeWorkflowClient:
    def __init__(self, responses: list[dict[str, object]]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict[str, object] | None, tuple[int, ...], str | None]] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, object]:
        self.calls.append((method, path, payload, expected, label))
        if not self.responses:
            raise AssertionError(f"unexpected request: {method} {path}")
        return self.responses.pop(0)


class RunWorkflowScenarioTests(unittest.TestCase):
    def test_progress_verification_cannot_finish_when_advisories_remain(self) -> None:
        self.assertFalse(
            run_workflow_scenario.progress_verification_can_end_run(
                {
                    "passed": True,
                    "advisories": ["blocked sequence not observed yet"],
                },
                workflow={
                    "tasks": [
                        {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                    ]
                },
            )
        )

    def test_progress_verification_cannot_finish_while_tasks_are_active(self) -> None:
        self.assertFalse(
            run_workflow_scenario.progress_verification_can_end_run(
                {
                    "passed": True,
                    "advisories": [],
                },
                workflow={
                    "tasks": [
                        {"id": "task-1", "is_orchestrator_task": False, "state": "in_progress"},
                    ]
                },
            )
        )

    def test_progress_verification_can_finish_once_clean_and_idle(self) -> None:
        self.assertTrue(
            run_workflow_scenario.progress_verification_can_end_run(
                {
                    "passed": True,
                    "advisories": [],
                },
                workflow={
                    "tasks": [
                        {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                    ]
                },
            )
        )

    def test_evaluate_progress_expectations_outcome_driven_waits_for_clean_runtime_cleanup(self) -> None:
        workflow = {"id": "wf-1", "state": "active", "tasks": []}
        expectations = {
            "state": "active",
            "outcome_envelope": {
                "allowed_states": ["active"],
                "require_output_artifacts": True,
                "require_completed_non_orchestrator_tasks": True,
                "require_terminal_work_items": True,
                "require_db_state": True,
                "require_runtime_cleanup": True,
                "require_fatal_log_free": True,
            },
        }
        board = {
            "data": {
                "data": {
                    "columns": [{"id": "done", "is_terminal": True}, {"id": "blocked", "is_blocked": True}],
                    "work_items": [
                        {"id": "wi-done", "column_id": "done"},
                        {"id": "wi-blocked", "column_id": "blocked"},
                    ],
                }
            }
        }
        work_items = {
            "data": {
                "data": [
                    {"id": "wi-done", "column_id": "done"},
                    {"id": "wi-blocked", "column_id": "blocked"},
                ]
            }
        }
        artifacts = {"data": {"items": [{"logical_path": "deliverables/out.md"}]}}
        fake_client = object()

        with (
            mock.patch.object(
                run_workflow_scenario,
                "fetch_workflow_tasks",
                return_value=[
                    {"id": "task-specialist", "is_orchestrator_task": False, "state": "completed"},
                ],
            ),
            mock.patch.object(run_workflow_scenario, "collect_workflow_events", return_value={"ok": True, "data": []}),
            mock.patch.object(run_workflow_scenario, "collect_execution_logs", return_value={"data": []}),
            mock.patch.object(run_workflow_scenario, "summarize_efficiency", return_value={}),
            mock.patch.object(
                run_workflow_scenario,
                "collect_live_container_snapshot",
                return_value={"ok": True, "data": {"data": [{"kind": "orchestrator", "container_id": "c-1"}]}},
            ),
            mock.patch.object(run_workflow_scenario, "collect_db_state_snapshot", return_value={"ok": True}),
            mock.patch.object(run_workflow_scenario, "summarize_log_anomalies", return_value={"count": 0, "rows": []}),
            mock.patch.object(
                run_workflow_scenario,
                "inspect_runtime_cleanup",
                return_value={"all_clean": False, "runtime_containers": [{"container_id": "c-1", "clean": False}]},
            ),
        ):
            verification = run_workflow_scenario.evaluate_progress_expectations(
                fake_client,  # type: ignore[arg-type]
                workflow_id="wf-1",
                expectations=expectations,
                workflow=workflow,
                board=board,
                work_items=work_items,
                stage_gates={"data": []},
                workspace={},
                artifacts=artifacts,
                approval_actions=[],
                fleet={},
                playbook_id="pb-1",
                fleet_peaks={},
                verification_mode=run_workflow_scenario.OUTCOME_DRIVEN_VERIFICATION_MODE,
                trace=None,
            )

        self.assertFalse(verification["passed"])
        self.assertIn(
            "expected runtime cleanup evidence to show no dangling runtimes",
            verification["failures"],
        )

    def test_evaluate_progress_expectations_outcome_driven_passes_after_clean_runtime_cleanup(self) -> None:
        workflow = {"id": "wf-1", "state": "active", "tasks": []}
        expectations = {
            "state": "active",
            "outcome_envelope": {
                "allowed_states": ["active"],
                "require_output_artifacts": True,
                "require_completed_non_orchestrator_tasks": True,
                "require_terminal_work_items": True,
                "require_db_state": True,
                "require_runtime_cleanup": True,
                "require_fatal_log_free": True,
            },
        }
        board = {
            "data": {
                "data": {
                    "columns": [{"id": "done", "is_terminal": True}, {"id": "blocked", "is_blocked": True}],
                    "work_items": [
                        {"id": "wi-done", "column_id": "done"},
                        {"id": "wi-blocked", "column_id": "blocked"},
                    ],
                }
            }
        }
        work_items = {
            "data": {
                "data": [
                    {"id": "wi-done", "column_id": "done"},
                    {"id": "wi-blocked", "column_id": "blocked"},
                ]
            }
        }
        artifacts = {"data": {"items": [{"logical_path": "deliverables/out.md"}]}}
        fake_client = object()

        with (
            mock.patch.object(
                run_workflow_scenario,
                "fetch_workflow_tasks",
                return_value=[
                    {"id": "task-specialist", "is_orchestrator_task": False, "state": "completed"},
                ],
            ),
            mock.patch.object(run_workflow_scenario, "collect_workflow_events", return_value={"ok": True, "data": []}),
            mock.patch.object(run_workflow_scenario, "collect_execution_logs", return_value={"data": []}),
            mock.patch.object(run_workflow_scenario, "summarize_efficiency", return_value={}),
            mock.patch.object(
                run_workflow_scenario,
                "collect_live_container_snapshot",
                return_value={"ok": True, "data": {"data": [{"kind": "orchestrator", "container_id": "c-1"}]}},
            ),
            mock.patch.object(run_workflow_scenario, "collect_db_state_snapshot", return_value={"ok": True}),
            mock.patch.object(run_workflow_scenario, "summarize_log_anomalies", return_value={"count": 0, "rows": []}),
            mock.patch.object(
                run_workflow_scenario,
                "inspect_runtime_cleanup",
                return_value={"all_clean": True, "runtime_containers": [{"container_id": "c-1", "clean": True}]},
            ),
        ):
            verification = run_workflow_scenario.evaluate_progress_expectations(
                fake_client,  # type: ignore[arg-type]
                workflow_id="wf-1",
                expectations=expectations,
                workflow=workflow,
                board=board,
                work_items=work_items,
                stage_gates={"data": []},
                workspace={},
                artifacts=artifacts,
                approval_actions=[],
                fleet={},
                playbook_id="pb-1",
                fleet_peaks={},
                verification_mode=run_workflow_scenario.OUTCOME_DRIVEN_VERIFICATION_MODE,
                trace=None,
            )

        self.assertTrue(verification["passed"])

    def test_fetch_workflow_tasks_collects_paginated_task_pages(self) -> None:
        client = FakeWorkflowClient(
            [
                {
                    "data": [{"id": "task-2"}, {"id": "task-1"}],
                    "meta": {"page": 1, "pages": 2, "per_page": 2, "total": 3},
                },
                {
                    "data": [{"id": "task-3"}],
                    "meta": {"page": 2, "pages": 2, "per_page": 2, "total": 3},
                },
            ]
        )

        tasks = run_workflow_scenario.fetch_workflow_tasks(client, workflow_id="wf-1")

        self.assertEqual(
            [{"id": "task-2"}, {"id": "task-1"}, {"id": "task-3"}],
            tasks,
        )
        self.assertEqual(
            [
                ("GET", "/api/v1/tasks?workflow_id=wf-1&page=1&per_page=100", None, (200,), "tasks.list:1"),
                ("GET", "/api/v1/tasks?workflow_id=wf-1&page=2&per_page=100", None, (200,), "tasks.list:2"),
            ],
            client.calls,
        )

    def test_default_final_settle_window_covers_one_minute(self) -> None:
        self.assertEqual(60, run_workflow_scenario.DEFAULT_FINAL_SETTLE_ATTEMPTS)
        self.assertEqual(1, run_workflow_scenario.DEFAULT_FINAL_SETTLE_DELAY_SECONDS)

    def test_build_db_state_query_uses_work_item_column_id_not_missing_state_column(self) -> None:
        query = run_workflow_scenario.build_db_state_query("wf-1")

        self.assertIn("column_id", query)
        self.assertNotIn(
            "SELECT\n          id,\n          title,\n          state,\n          stage_name,\n          column_id,",
            query,
        )

    def test_emit_run_result_writes_directly_to_tmp_file_when_configured(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "workflow-run.json.tmp"
            previous_value = os.environ.get("LIVE_TEST_SCENARIO_RUN_TMP_FILE")
            os.environ["LIVE_TEST_SCENARIO_RUN_TMP_FILE"] = str(output_path)
            try:
                run_workflow_scenario.emit_run_result({"workflow_id": "wf-1", "verification": {"passed": False}})
            finally:
                if previous_value is None:
                    os.environ.pop("LIVE_TEST_SCENARIO_RUN_TMP_FILE", None)
                else:
                    os.environ["LIVE_TEST_SCENARIO_RUN_TMP_FILE"] = previous_value

            self.assertTrue(output_path.is_file())
            self.assertEqual(
                {"workflow_id": "wf-1", "verification": {"passed": False}},
                json.loads(output_path.read_text(encoding="utf-8")),
            )

    def test_workflow_is_fully_terminal_requires_terminal_task_states(self) -> None:
        self.assertFalse(
            run_workflow_scenario.workflow_is_fully_terminal(
                {
                    "state": "completed",
                    "tasks": [
                        {"id": "task-1", "state": "completed"},
                        {"id": "task-2", "state": "in_progress"},
                    ],
                }
            )
        )
        self.assertTrue(
            run_workflow_scenario.workflow_is_fully_terminal(
                {
                    "state": "completed",
                    "tasks": [
                        {"id": "task-1", "state": "completed"},
                        {"id": "task-2", "state": "failed"},
                    ],
                }
            )
        )

    def test_refresh_terminal_workflow_snapshot_refetches_until_tasks_are_terminal(self) -> None:
        client = FakeWorkflowClient(
            [
                {
                    "data": {
                        "id": "wf-1",
                        "state": "completed",
                        "tasks": [
                            {"id": "task-1", "state": "completed"},
                            {"id": "task-2", "state": "completed"},
                        ],
                    }
                }
            ]
        )

        refreshed = run_workflow_scenario.refresh_terminal_workflow_snapshot(
            client,
            workflow_id="wf-1",
            workflow={
                "id": "wf-1",
                "state": "completed",
                "tasks": [
                    {"id": "task-1", "state": "completed"},
                    {"id": "task-2", "state": "in_progress"},
                ],
            },
            max_attempts=2,
            delay_seconds=0,
        )

        self.assertEqual("completed", refreshed["tasks"][1]["state"])
        self.assertEqual(
            [("GET", "/api/v1/workflows/wf-1", None, (200,), "workflows.get.final")],
            client.calls,
        )

    def test_refresh_terminal_workflow_snapshot_retries_multiple_times_before_returning(self) -> None:
        client = FakeWorkflowClient(
            [
                {
                    "data": {
                        "id": "wf-1",
                        "state": "completed",
                        "tasks": [
                            {"id": "task-1", "state": "completed"},
                            {"id": "task-2", "state": "in_progress"},
                        ],
                    }
                },
                {
                    "data": {
                        "id": "wf-1",
                        "state": "completed",
                        "tasks": [
                            {"id": "task-1", "state": "completed"},
                            {"id": "task-2", "state": "completed"},
                        ],
                    }
                },
            ]
        )

        refreshed = run_workflow_scenario.refresh_terminal_workflow_snapshot(
            client,
            workflow_id="wf-1",
            workflow={
                "id": "wf-1",
                "state": "completed",
                "tasks": [
                    {"id": "task-1", "state": "completed"},
                    {"id": "task-2", "state": "in_progress"},
                ],
            },
            max_attempts=3,
            delay_seconds=0,
        )

        self.assertEqual("completed", refreshed["tasks"][1]["state"])
        self.assertEqual(2, len(client.calls))

    def test_settle_final_live_container_evidence_waits_for_clean_runtime_cleanup(self) -> None:
        client = FakePagedClient(
            [
                {"ok": True, "data": [{"container_id": "c-1", "kind": "orchestrator"}]},
                {"ok": True, "data": [{"container_id": "c-1", "kind": "orchestrator"}]},
            ]
        )
        observations = run_workflow_scenario.new_container_observations()

        with (
            mock.patch.object(
                run_workflow_scenario,
                "inspect_runtime_cleanup",
                side_effect=[
                    {"all_clean": False, "runtime_containers": [{"container_id": "c-1", "clean": False}]},
                    {"all_clean": True, "runtime_containers": [{"container_id": "c-1", "clean": True}]},
                ],
            ) as cleanup_mock,
            mock.patch.object(
                run_workflow_scenario,
                "inspect_docker_log_rotation",
                return_value={"all_runtime_containers_bounded": True, "runtime_containers": []},
            ) as rotation_mock,
            mock.patch.object(run_workflow_scenario.time, "sleep") as sleep_mock,
        ):
            live_snapshot, runtime_cleanup, docker_log_rotation = run_workflow_scenario.settle_final_live_container_evidence(
                client,
                max_attempts=2,
                delay_seconds=0,
                trace=None,
                live_container_observations=observations,
            )

        self.assertTrue(live_snapshot["ok"])
        self.assertTrue(runtime_cleanup["all_clean"])
        self.assertTrue(docker_log_rotation["all_runtime_containers_bounded"])
        self.assertEqual(2, cleanup_mock.call_count)
        self.assertEqual(2, rotation_mock.call_count)
        self.assertEqual(1, len(run_workflow_scenario.container_observation_rows(observations)))
        sleep_mock.assert_called_once_with(0)
        self.assertEqual(
            [
                ("GET", "/api/v1/fleet/live-containers", None, (200,), "containers.list.final"),
                ("GET", "/api/v1/fleet/live-containers", None, (200,), "containers.list.final"),
            ],
            client.calls,
        )

    def test_build_run_result_payload_includes_explicit_scenario_and_provider_mode(self) -> None:
        payload = run_workflow_scenario.build_run_result_payload(
            workflow_id="wf-1",
            final_state="completed",
            timed_out=False,
            poll_iterations=7,
            scenario_name="sdlc-lite-approval-request-changes-then-approve",
            approval_mode="scripted",
            provider_auth_mode="oauth",
            verification_mode="outcome_driven",
            workflow={"id": "wf-1", "state": "completed", "tasks": []},
            board={"ok": True},
            work_items={"ok": True},
            events={"ok": True},
            approvals={"ok": True},
            approval_actions=[],
            workflow_actions=[],
            workspace={"id": "workspace-1"},
            artifacts={"ok": True},
            fleet={"ok": True},
            fleet_peaks={"peak_running": 1},
            execution_logs={
                "data": [
                    {
                        "task_id": "task-spec-1",
                        "operation": "llm.chat_stream",
                        "status": "started",
                        "payload": {
                            "messages": [
                                {"role": "system", "content": "## Workflow Mode: planned\nDurable instructions only."},
                                {
                                    "role": "user",
                                    "content": "Authoritative specialist execution brief.\n\n## Workflow Brief\nFocus on implementation.",
                                },
                            ]
                        },
                    }
                ]
            },
            efficiency={
                "workflow_duration_seconds": 12.5,
                "total_llm_turns": 4,
                "total_tool_steps": 6,
                "total_bursts": 3,
                "orchestrator_max_llm_turns": 1,
                "non_orchestrator_max_llm_turns": 3,
                "non_orchestrator_max_llm_turns_per_attempt": 1.5,
                "specialist_teardown": {"max_lag_seconds": 1.2},
            },
            verification={"passed": True, "failures": [], "checks": []},
        )

        self.assertEqual("sdlc-lite-approval-request-changes-then-approve", payload["scenario"])
        self.assertEqual("sdlc-lite-approval-request-changes-then-approve", payload["scenario_name"])
        self.assertEqual("oauth", payload["provider_auth_mode"])
        self.assertEqual("outcome_driven", payload["verification_mode"])
        self.assertEqual("completed", payload["workflow_state"])
        self.assertTrue(payload["verification_passed"])
        self.assertEqual(0, payload["runner_exit_code"])
        self.assertFalse(payload["harness_failure"])
        self.assertEqual(12.5, payload["workflow_duration_seconds"])
        self.assertEqual(1.5, payload["non_orchestrator_max_llm_turns_per_attempt"])
        self.assertEqual(4, payload["total_llm_turns"])
        self.assertEqual(6, payload["total_tool_steps"])
        self.assertEqual(3, payload["total_bursts"])
        self.assertEqual(1, payload["orchestrator_max_llm_turns"])
        self.assertEqual(3, payload["non_orchestrator_max_llm_turns"])
        self.assertEqual(1.2, payload["specialist_teardown_lag_seconds"])
        self.assertEqual(1, payload["brief_proof"]["task_count"])
        self.assertTrue(payload["brief_proof"]["tasks"][0]["execution_brief_present"])
        self.assertFalse(payload["brief_proof"]["tasks"][0]["system_prompt_contains_workflow_brief"])
        self.assertIn("## Workflow Brief", payload["brief_proof"]["tasks"][0]["execution_brief_excerpt"])
        self.assertIn("outcome_metrics", payload)
        self.assertEqual("passed", payload["outcome_metrics"]["status"])

    def test_build_brief_proof_prefers_task_started_summary(self) -> None:
        proof = run_workflow_scenario.build_brief_proof(
            workflow={
                "tasks": [
                    {
                        "id": "task-spec-1",
                        "role": "developer",
                        "is_orchestrator_task": False,
                    }
                ]
            },
            logs={
                "data": [
                    {
                        "task_id": "task-spec-1",
                        "operation": "task.execute",
                        "status": "started",
                        "payload": {
                            "execution_brief_present": True,
                            "execution_brief_hash": "brief-hash-1",
                            "execution_brief_refresh_key": "refresh-key-1",
                            "execution_brief_excerpt": "## Workflow Brief\nFocus on the implementation handoff.",
                            "execution_brief_current_focus": {
                                "lifecycle": "planned",
                                "stage_name": "implementation",
                            },
                            "execution_brief_predecessor_handoff_id": "handoff-1",
                            "execution_brief_memory_ref_keys": ["release_note"],
                            "execution_brief_artifact_paths": ["docs/requirements.md"],
                        },
                    },
                    {
                        "task_id": "task-spec-1",
                        "operation": "llm.chat_stream",
                        "status": "started",
                        "payload": {
                            "messages": [
                                {"role": "system", "content": "## Workflow Brief\nThis should not win."},
                                {"role": "user", "content": "Authoritative specialist execution brief."},
                            ]
                        },
                    },
                ]
            },
        )

        self.assertEqual(1, proof["task_count"])
        self.assertEqual("task.execute.started", proof["tasks"][0]["source"])
        self.assertEqual("brief-hash-1", proof["tasks"][0]["execution_brief_hash"])
        self.assertEqual("refresh-key-1", proof["tasks"][0]["execution_brief_refresh_key"])
        self.assertEqual(["release_note"], proof["tasks"][0]["execution_brief_memory_ref_keys"])
        self.assertEqual(["docs/requirements.md"], proof["tasks"][0]["execution_brief_artifact_paths"])
        self.assertFalse(proof["tasks"][0]["system_prompt_contains_workflow_brief"])

    def test_build_run_result_payload_does_not_mark_expected_pending_ongoing_workflow_as_timed_out(
        self,
    ) -> None:
        payload = run_workflow_scenario.build_run_result_payload(
            workflow_id="wf-1",
            final_state="pending",
            timed_out=False,
            poll_iterations=50,
            scenario_name="ongoing-intake-reuse-positive",
            approval_mode="none",
            provider_auth_mode="oauth",
            verification_mode="outcome_driven",
            workflow={"id": "wf-1", "state": "pending", "lifecycle": "ongoing", "tasks": []},
            board={"ok": True},
            work_items={"ok": True},
            events={"ok": True},
            approvals={"ok": True},
            approval_actions=[],
            workflow_actions=[],
            workspace={"id": "workspace-1"},
            artifacts={"ok": True},
            fleet={"ok": True},
            fleet_peaks={"peak_running": 1},
            verification={"passed": True, "failures": [], "checks": []},
        )

        self.assertFalse(payload["timed_out"])
        self.assertFalse(payload["terminal"])
        self.assertEqual("pending", payload["workflow_state"])
        self.assertEqual(0, payload["runner_exit_code"])

    def test_build_scenario_outcome_metrics_summarizes_recovery_and_remaining_risk(self) -> None:
        metrics = run_workflow_scenario.build_scenario_outcome_metrics(
            final_state="completed",
            verification={"passed": True, "failures": [], "checks": [], "advisories": ["ideal path drift"]},
            workflow={
                "id": "wf-1",
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-1",
                        "is_orchestrator_task": False,
                        "state": "completed",
                        "metrics": {
                            "iterations": 4,
                            "input_tokens": 1200,
                            "output_tokens": 300,
                            "total_tokens": 1500,
                        },
                    },
                    {
                        "id": "task-2",
                        "is_orchestrator_task": True,
                        "state": "completed",
                        "metrics": {
                            "iterations": 3,
                            "input_tokens": 800,
                            "output_tokens": 200,
                            "total_tokens": 1000,
                        },
                    },
                ],
                "completion_callouts": {
                    "completion_notes": "Closed with explicit operator caveats.",
                    "residual_risks": ["Pending brand review"],
                    "waived_steps": [{"code": "secondary_review", "reason": "Primary review was decisive."}],
                    "unresolved_advisory_items": [{"kind": "approval", "summary": "Approval stayed advisory."}],
                },
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={
                "data": {
                    "data": [
                        {
                            "id": "wi-1",
                            "column_id": "done",
                            "completion_callouts": {
                                "unresolved_advisory_items": [{"kind": "escalation", "summary": "Escalation remained advisory."}],
                            },
                        }
                    ]
                }
            },
            stage_gates={"data": [{"id": "gate-1", "closure_effect": "advisory"}]},
            artifacts={"data": {"items": [{"logical_path": "reports/summary.md"}]}},
            approval_actions=[{"action": "approve"}],
            workflow_actions=[{"type": "create_work_items", "count": 1}],
            execution_logs={
                "data": [
                    {"operation": "task.execute", "role": "orchestrator", "actor_name": "orch-a"},
                    {"operation": "task.execute", "role": "orchestrator", "actor_name": "orch-b"},
                    {"operation": "tool_call", "payload": {"tool": "waive_preferred_step"}},
                    {"operation": "tool_call", "payload": {"tool": "close_workflow_with_callouts"}},
                    {
                        "operation": "tool_result",
                        "payload": {
                            "tool": "request_gate_approval",
                            "output": '{"mutation_outcome":"recoverable_not_applied","recovery_class":"approval_not_configured","suggested_next_actions":[{"action":"continue_workflow"}]}',
                        },
                    },
                ]
            },
            evidence={
                "log_anomalies": {
                    "rows": [
                        {"level": "warning"},
                        {"level": "error"},
                    ]
                },
                "http_status_summary": {
                    "status_counts": {"400": 2, "500": 1},
                    "client_error_count": 2,
                    "server_error_count": 1,
                },
                "runtime_cleanup": {
                    "all_clean": True,
                    "runtime_containers": [{"kind": "orchestrator"}, {"kind": "orchestrator"}],
                },
                "live_containers": {"data": [{"kind": "orchestrator"}, {"kind": "orchestrator"}]},
                "container_observations": {
                    "rows": [
                        {"kind": "orchestrator"},
                        {"kind": "specialist", "task_id": "task-1"},
                        {"kind": "specialist", "task_id": "task-2"},
                    ]
                },
            },
        )

        self.assertEqual("passed", metrics["status"])
        self.assertEqual(1, metrics["success"]["output_artifact_count"])
        self.assertEqual(1, metrics["success"]["completed_non_orchestrator_task_count"])
        self.assertEqual(1, metrics["closure"]["residual_risk_count"])
        self.assertEqual(1, metrics["closure"]["waived_step_count"])
        self.assertEqual(2, metrics["closure"]["unresolved_advisory_item_count"])
        self.assertEqual({"advisory": 1}, metrics["invoked_controls"]["closure_effect_counts"])
        self.assertEqual(2, metrics["orchestrator_improvisation"]["helper_tool_usage_count"])
        self.assertEqual({"waive_preferred_step": 1, "close_workflow_with_callouts": 1}, metrics["orchestrator_improvisation"]["helper_tool_counts"])
        self.assertEqual(1, metrics["orchestrator_improvisation"]["recoverable_mutation_count"])
        self.assertEqual({"approval_not_configured": 1}, metrics["orchestrator_improvisation"]["recovery_class_counts"])
        self.assertEqual(1, metrics["orchestrator_improvisation"]["suggested_next_action_count"])
        self.assertEqual(1, metrics["verification"]["advisory_count"])
        self.assertEqual(1, metrics["anomalies"]["warning_count"])
        self.assertEqual(1, metrics["anomalies"]["error_count"])
        self.assertEqual({"400": 2, "500": 1}, metrics["anomalies"]["http_status_counts"])
        self.assertEqual(2, metrics["anomalies"]["http_client_error_count"])
        self.assertEqual(1, metrics["anomalies"]["http_server_error_count"])
        self.assertTrue(metrics["hygiene"]["runtime_cleanup_passed"])
        self.assertEqual(2, metrics["orchestrator_distribution"]["distinct_runtime_count"])
        self.assertEqual(["orch-a", "orch-b"], metrics["orchestrator_distribution"]["runtime_actors"])
        self.assertEqual(7, metrics["agentic_effort"]["total_loop_count"])
        self.assertEqual(3, metrics["agentic_effort"]["orchestrator_loop_count"])
        self.assertEqual(4, metrics["agentic_effort"]["specialist_loop_count"])
        self.assertEqual(2000, metrics["agentic_effort"]["input_token_count"])
        self.assertEqual(500, metrics["agentic_effort"]["output_token_count"])
        self.assertEqual(2500, metrics["agentic_effort"]["total_token_count"])

    def test_evaluate_expectations_outcome_driven_mode_accepts_repo_backed_task_output(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-1",
                        "role": "publisher",
                        "is_orchestrator_task": False,
                        "state": "completed",
                        "output": {
                            "summary": "Published the release packet and pushed the repository branch.",
                            "artifacts": [
                                {"path": "/tmp/agirunner-artifacts/task-1/files_changed.json", "size": 128},
                                {"path": "/tmp/agirunner-artifacts/task-1/git_diff.patch", "size": 512},
                            ],
                        },
                    },
                ],
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "done"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            evidence={
                "db_state": {"ok": True},
                "runtime_cleanup": {"all_clean": True},
                "log_anomalies": {"rows": []},
            },
            verification_mode="outcome_driven",
        )

        self.assertTrue(verification["passed"])

    def test_write_evidence_artifacts_writes_outcome_metrics_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            trace_dir = str(Path(tmpdir) / "trace")
            Path(trace_dir).mkdir(parents=True, exist_ok=True)

            written = run_workflow_scenario.write_evidence_artifacts(
                trace_dir,
                {
                    "db_state": {"ok": True},
                    "scenario_outcome_metrics": {"status": "passed", "success": {"output_artifact_count": 1}},
                },
            )

            self.assertIn("scenario_outcome_metrics", written)
            self.assertTrue(written["scenario_outcome_metrics"].endswith("scenario-outcome-metrics.json"))
            payload = json.loads(Path(written["scenario_outcome_metrics"]).read_text())
            self.assertEqual("passed", payload["status"])

    def test_collect_execution_logs_paginates_all_pages(self) -> None:
        client = FakeWorkflowClient(
            [
                {
                    "data": [
                        {
                            "id": "log-1",
                            "task_id": "task-1",
                            "operation": "llm.chat_stream",
                            "status": "completed",
                            "payload": {"burst_id": 1},
                            "created_at": "2026-03-20T10:00:00Z",
                        }
                    ],
                    "pagination": {
                        "has_more": True,
                        "next_cursor": "cursor-1",
                        "prev_cursor": None,
                    },
                },
                {
                    "data": [
                        {
                            "id": "log-2",
                            "task_id": "task-1",
                            "operation": "tool.execute",
                            "status": "completed",
                            "payload": {"burst_id": 1},
                            "created_at": "2026-03-20T10:00:01Z",
                        }
                    ],
                    "pagination": {
                        "has_more": False,
                        "next_cursor": None,
                        "prev_cursor": "cursor-1",
                    },
                },
            ]
        )

        snapshot = run_workflow_scenario.collect_execution_logs(client, workflow_id="wf-1", per_page=1)

        self.assertEqual(2, len(snapshot["data"]))
        self.assertEqual(
            [
                ("GET", "/api/v1/logs?workflow_id=wf-1&per_page=1&detail=full&order=asc", None, (200,), "logs.list"),
                (
                    "GET",
                    "/api/v1/logs?workflow_id=wf-1&per_page=1&detail=full&order=asc&cursor=cursor-1",
                    None,
                    (200,),
                    "logs.list",
                ),
            ],
            client.calls,
        )

    def test_summarize_efficiency_aggregates_task_turns_approval_lag_and_teardown(self) -> None:
        workflow = {
            "id": "wf-1",
            "state": "completed",
            "created_at": "2026-03-20T09:59:50Z",
            "completed_at": "2026-03-20T10:00:20Z",
            "tasks": [
                {
                    "id": "task-orch-1",
                    "role": "orchestrator",
                    "is_orchestrator_task": True,
                    "state": "completed",
                },
                {
                    "id": "task-spec-1",
                    "role": "developer",
                    "is_orchestrator_task": False,
                    "state": "completed",
                },
            ],
        }
        logs = {
            "data": [
                {
                    "id": "log-1",
                    "task_id": "task-orch-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {"burst_id": 1},
                    "created_at": "2026-03-20T09:59:55Z",
                },
                {
                    "id": "log-2",
                    "task_id": "task-spec-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {
                        "burst_id": 1,
                        "repeated_read_count": 1,
                        "duplicate_status_check_count": 0,
                        "checkpoint_count": 1,
                        "verify_count": 1,
                    },
                    "created_at": "2026-03-20T10:00:00Z",
                },
                {
                    "id": "log-3",
                    "task_id": "task-spec-1",
                    "operation": "tool.execute",
                    "status": "completed",
                    "payload": {"burst_id": 1},
                    "created_at": "2026-03-20T10:00:01Z",
                },
                {
                    "id": "log-4",
                    "task_id": "task-spec-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {
                        "burst_id": 2,
                        "repeated_read_count": 2,
                        "duplicate_status_check_count": 1,
                        "checkpoint_count": 1,
                        "verify_count": 2,
                    },
                    "created_at": "2026-03-20T10:00:03Z",
                },
                {
                    "id": "log-5",
                    "task_id": "task-spec-1",
                    "operation": "tool.execute",
                    "status": "completed",
                    "payload": {"burst_id": 2},
                    "created_at": "2026-03-20T10:00:04Z",
                },
                {
                    "id": "log-6",
                    "task_id": "task-spec-1",
                    "operation": "task.execute",
                    "status": "completed",
                    "payload": {},
                    "created_at": "2026-03-20T10:00:05Z",
                },
                {
                    "id": "log-7",
                    "task_id": "task-spec-1",
                    "operation": "container.remove",
                    "status": "completed",
                    "payload": {},
                    "created_at": "2026-03-20T10:00:07Z",
                },
            ]
        }
        events = {
            "ok": True,
            "data": {
                "data": [
                    {
                        "type": "stage.gate_requested",
                        "created_at": "2026-03-20T10:00:00Z",
                        "data": {"gate_id": "gate-1", "stage_name": "approval"},
                    },
                    {
                        "type": "stage.gate.approve",
                        "created_at": "2026-03-20T10:00:10Z",
                        "data": {"gate_id": "gate-1", "stage_name": "approval"},
                    },
                    {
                        "type": "workflow.activation_started",
                        "created_at": "2026-03-20T10:00:11Z",
                        "data": {"activation_id": "activation-1", "event_type": "stage.gate.approve"},
                    },
                    {
                        "type": "workflow.activation_completed",
                        "created_at": "2026-03-20T10:00:12Z",
                        "data": {"activation_id": "activation-1", "event_type": "stage.gate.approve"},
                    },
                ]
            },
        }
        approval_actions = [
            {
                "gate_id": "gate-1",
                "action": "approve",
                "stage_name": "approval",
                "submitted_at": "2026-03-20T10:00:10Z",
            }
        ]

        summary = run_workflow_scenario.summarize_efficiency(
            workflow=workflow,
            logs=logs,
            events=events,
            approval_actions=approval_actions,
        )

        self.assertEqual(30.0, summary["workflow_duration_seconds"])
        self.assertEqual(3, summary["total_llm_turns"])
        self.assertEqual(2, summary["non_orchestrator_max_llm_turns"])
        self.assertEqual(2, summary["tasks"]["task-spec-1"]["burst_count"])
        self.assertEqual(2, summary["tasks"]["task-spec-1"]["max_repeated_read_count"])
        self.assertEqual(1, summary["tasks"]["task-spec-1"]["max_duplicate_status_check_count"])
        self.assertEqual(2.0, summary["specialist_teardown"]["max_lag_seconds"])
        self.assertEqual(
            1.0,
            summary["approval_metrics"][0]["decision_to_continuation_started_seconds"],
        )
        self.assertEqual(
            2.0,
            summary["approval_metrics"][0]["decision_to_continuation_completed_seconds"],
        )

    def test_summarize_efficiency_normalizes_reused_task_turns_by_attempt_count(self) -> None:
        workflow = {
            "id": "wf-1",
            "state": "completed",
            "created_at": "2026-03-20T09:59:50Z",
            "completed_at": "2026-03-20T10:00:20Z",
            "tasks": [
                {
                    "id": "task-dev-1",
                    "role": "developer",
                    "is_orchestrator_task": False,
                    "state": "completed",
                    "rework_count": 2,
                }
            ],
        }
        logs = {
            "data": [
                {
                    "id": "log-1",
                    "task_id": "task-dev-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {"burst_id": 1},
                    "created_at": "2026-03-20T09:59:55Z",
                },
                {
                    "id": "log-2",
                    "task_id": "task-dev-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {"burst_id": 1},
                    "created_at": "2026-03-20T09:59:56Z",
                },
                {
                    "id": "log-3",
                    "task_id": "task-dev-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {"burst_id": 2},
                    "created_at": "2026-03-20T09:59:57Z",
                },
                {
                    "id": "log-4",
                    "task_id": "task-dev-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {"burst_id": 2},
                    "created_at": "2026-03-20T09:59:58Z",
                },
                {
                    "id": "log-5",
                    "task_id": "task-dev-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {"burst_id": 3},
                    "created_at": "2026-03-20T09:59:59Z",
                },
                {
                    "id": "log-6",
                    "task_id": "task-dev-1",
                    "operation": "llm.chat_stream",
                    "status": "completed",
                    "payload": {"burst_id": 3},
                    "created_at": "2026-03-20T10:00:00Z",
                },
            ]
        }

        summary = run_workflow_scenario.summarize_efficiency(
            workflow=workflow,
            logs=logs,
            events={"ok": True, "data": []},
            approval_actions=[],
        )

        self.assertEqual(6, summary["tasks"]["task-dev-1"]["llm_turns"])
        self.assertEqual(3, summary["tasks"]["task-dev-1"]["attempt_count"])
        self.assertEqual(2.0, summary["tasks"]["task-dev-1"]["llm_turns_per_attempt"])
        self.assertEqual(2.0, summary["non_orchestrator_max_llm_turns_per_attempt"])

    def test_evaluate_expectations_checks_efficiency_thresholds(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "efficiency": {
                    "workflow_duration_seconds_lte": 60,
                    "non_orchestrator_max_llm_turns_lte": 3,
                    "non_orchestrator_max_llm_turns_per_attempt_lte": 2,
                    "non_orchestrator_max_tool_steps_lte": 4,
                    "approval_decision_to_continuation_started_seconds_lte": 2,
                    "approval_decision_to_continuation_completed_seconds_lte": 3,
                    "specialist_teardown_lag_seconds_lte": 3,
                    "orphan_cleanup_events_eq": 0,
                }
            },
            workflow={"state": "completed", "tasks": []},
            board={"ok": True, "data": {"columns": []}},
            work_items={"ok": True, "data": []},
            workspace={"memory": {}, "memory_index": {"keys": []}, "artifact_index": {"items": []}},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={"ok": True, "data": {"by_playbook_pool": []}},
            efficiency={
                "workflow_duration_seconds": 30.0,
                "non_orchestrator_max_llm_turns": 2,
                "non_orchestrator_max_llm_turns_per_attempt": 2.0,
                "non_orchestrator_max_tool_steps": 2,
                "approval_metrics": [
                    {
                        "decision_to_continuation_started_seconds": 1.0,
                        "decision_to_continuation_completed_seconds": 2.0,
                    }
                ],
                "specialist_teardown": {"max_lag_seconds": 2.0, "orphan_cleanup_events": 0},
            },
        )

        self.assertTrue(result["passed"])
        check_names = {entry["name"] for entry in result["checks"]}
        self.assertIn("efficiency.workflow_duration_seconds_lte", check_names)
        self.assertIn("efficiency.non_orchestrator_max_llm_turns_lte", check_names)
        self.assertIn("efficiency.non_orchestrator_max_llm_turns_per_attempt_lte", check_names)
        self.assertIn("efficiency.specialist_teardown_lag_seconds_lte", check_names)

    def test_evaluate_expectations_counts_blocked_board_items_from_generic_blocking_signals(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "state": "active",
                "board": {
                    "blocked_count": 2,
                },
            },
            workflow={"state": "active", "tasks": []},
            board={
                "ok": True,
                "data": {
                    "columns": [
                        {"id": "doing", "label": "Doing"},
                        {"id": "halted", "label": "Halted", "is_blocked": True},
                    ],
                    "work_items": [
                        {
                            "id": "wi-assessment",
                            "column_id": "doing",
                            "assessment_status": "blocked",
                        },
                        {
                            "id": "wi-column",
                            "column_id": "halted",
                        },
                    ],
                },
            },
            work_items={"ok": True, "data": []},
            workspace={"memory": {}, "memory_index": {"keys": []}, "artifact_index": {"items": []}},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={"ok": True, "data": {"by_playbook_pool": []}},
        )

        self.assertTrue(result["passed"])

    def test_process_workflow_approvals_accepts_block_action(self) -> None:
        client = FakeClient()

        actions = run_workflow_scenario.process_workflow_approvals(
            client,
            {
                "stage_gates": [
                    {
                        "gate_id": "gate-1",
                        "workflow_id": "workflow-1",
                        "stage_name": "approval-gate",
                        "status": "awaiting_approval",
                    }
                ]
            },
            workflow_id="workflow-1",
            scenario_name="requirements-human-review-blocked",
            approved_gate_ids=set(),
            approval_mode="scripted",
            consumed_decisions=set(),
            approval_decisions=[
                {
                    "match": {"stage_name": "approval-gate"},
                    "action": "block",
                }
            ],
        )

        self.assertEqual(
            [
                {
                    "gate_id": "gate-1",
                    "action": "block",
                    "task_id": None,
                    "stage_name": "approval-gate",
                    "submitted_at": actions[0]["submitted_at"],
                }
            ],
            actions,
        )
        self.assertEqual("POST", client.calls[0][0])
        self.assertEqual("/api/v1/approvals/gate-1", client.calls[0][1])
        self.assertEqual("block", client.calls[0][2]["action"])

    def test_evaluate_expectations_checks_generic_work_item_field_matches(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "work_item_matches": [
                    {
                        "match": {"stage_name": "draft-review"},
                        "field_expectations": {
                            "blocked_state": "blocked",
                            "branch_status": "terminated",
                        },
                    }
                ]
            },
            workflow={"state": "active", "tasks": []},
            board={"ok": True},
            work_items={
                "ok": True,
                "data": [
                    {
                        "id": "wi-1",
                        "stage_name": "draft-review",
                        "blocked_state": "blocked",
                        "branch_status": "terminated",
                    }
                ],
            },
            workspace={},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={"ok": True, "data": {}},
            playbook_id="playbook-1",
            fleet_peaks={},
            efficiency=None,
            execution_logs={"ok": True, "data": []},
        )

        self.assertTrue(result["passed"])
        check_names = {check["name"] for check in result["checks"]}
        self.assertIn("work_item_matches:{'stage_name': 'draft-review'}", check_names)

    def test_evaluate_expectations_checks_stage_gate_matches(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "stage_gate_matches": [
                    {
                        "match": {"stage_name": "approval-gate"},
                        "field_expectations": {
                            "is_superseded": True,
                            "superseded_by_revision": 2,
                        },
                    }
                ]
            },
            workflow={"state": "active", "tasks": []},
            board={"ok": True},
            work_items={"ok": True, "data": []},
            workspace={},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={"ok": True, "data": {}},
            playbook_id="playbook-1",
            fleet_peaks={},
            efficiency=None,
            execution_logs={"ok": True, "data": []},
            stage_gates={
                "ok": True,
                "data": [
                    {
                        "id": "gate-1",
                        "stage_name": "approval-gate",
                        "is_superseded": True,
                        "superseded_by_revision": 2,
                    }
                ],
            },
        )

        self.assertTrue(result["passed"])
        check_names = {check["name"] for check in result["checks"]}
        self.assertIn("stage_gate_matches:{'stage_name': 'approval-gate'}", check_names)

    def test_evaluate_expectations_checks_approval_before_assessment_ordering(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "approval_before_assessment_sequences": [
                    {
                        "match": {"stage_name": "approval-gate"},
                        "assessed_by": "publishing-policy-assessor",
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-assessment-1",
                        "role": "publishing-policy-assessor",
                        "task_kind": "assessment",
                        "created_at": "2026-03-23T00:05:00Z",
                        "completed_at": "2026-03-23T00:06:00Z",
                    }
                ],
            },
            board={"ok": True},
            work_items={"ok": True, "data": []},
            workspace={},
            artifacts={"ok": True, "data": []},
            approval_actions=[
                {
                    "gate_id": "gate-1",
                    "action": "approve",
                    "stage_name": "approval-gate",
                    "submitted_at": "2026-03-23T00:04:00Z",
                }
            ],
            events={"ok": True, "data": []},
            fleet={"ok": True, "data": {}},
            playbook_id="playbook-1",
            fleet_peaks={},
            efficiency=None,
            execution_logs={"ok": True, "data": []},
        )

        self.assertTrue(result["passed"])

    def test_build_create_work_item_payloads_supports_branch_key_template(self) -> None:
        payloads = run_workflow_scenario.build_create_work_item_payloads(
            {
                "count": 2,
                "title_template": "branch-{index}",
                "goal_template": "Goal {index}",
                "acceptance_criteria_template": "Done {index}",
                "stage_name": "variant-draft",
                "branch_key_template": "branch-{index}",
            },
            workflow_id="workflow-1",
            scenario_name="content-terminate-branch-policy",
        )

        self.assertEqual("branch-1", payloads[0]["branch_key"])
        self.assertEqual("branch-2", payloads[1]["branch_key"])

    def test_summarize_efficiency_uses_runtime_teardown_completion_without_container_remove(self) -> None:
        workflow = {
            "created_at": "2026-03-20T10:00:00.000Z",
            "completed_at": "2026-03-20T10:00:10.000Z",
            "tasks": [
                {
                    "id": "task-spec-1",
                    "role": "live-test-developer",
                    "state": "completed",
                }
            ],
        }
        logs = {
            "data": [
                {
                    "id": "log-1",
                    "task_id": "task-spec-1",
                    "role": "live-test-developer",
                    "is_orchestrator_task": False,
                    "operation": "task.execute",
                    "status": "completed",
                    "payload": {},
                    "created_at": "2026-03-20T10:00:05Z",
                },
                {
                    "id": "log-2",
                    "task_id": "task-spec-1",
                    "role": "live-test-developer",
                    "is_orchestrator_task": False,
                    "operation": "runtime.teardown_completed",
                    "status": "completed",
                    "payload": {"reason": "specialist_task_complete"},
                    "created_at": "2026-03-20T10:00:07Z",
                },
            ]
        }

        summary = run_workflow_scenario.summarize_efficiency(
            workflow=workflow,
            logs=logs,
            events={"ok": True, "data": []},
            approval_actions=[],
        )

        self.assertEqual(
            "2026-03-20T10:00:07+00:00",
            summary["tasks"]["task-spec-1"]["teardown_completed_at"],
        )
        self.assertEqual(2.0, summary["specialist_teardown"]["max_lag_seconds"])

    def test_evaluate_expectations_checks_fleet_pool_bounds(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "fleet": {
                    "playbook_pool": {
                        "max_runtimes": 2,
                        "peak_running_lte": 2,
                        "peak_executing_lte": 2,
                        "peak_running_gte": 1,
                        "peak_executing_gte": 1,
                    }
                }
            },
            workflow={"state": "completed", "tasks": []},
            board={"ok": True, "data": {"columns": []}},
            work_items={"ok": True, "data": []},
            workspace={"memory": {}, "memory_index": {"keys": []}, "artifact_index": {"items": []}},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={
                "ok": True,
                "data": {
                    "by_playbook_pool": [
                        {
                            "playbook_id": "playbook-1",
                            "max_runtimes": 2,
                            "running": 0,
                            "executing": 0,
                            "active_workflows": 0,
                        }
                    ]
                },
            },
            playbook_id="playbook-1",
            fleet_peaks={"peak_running": 2, "peak_executing": 2, "peak_active_workflows": 1},
        )

        self.assertTrue(result["passed"])
        check_names = {entry["name"] for entry in result["checks"]}
        self.assertIn("fleet.playbook_pool.max_runtimes", check_names)
        self.assertIn("fleet.playbook_pool.peak_running_lte", check_names)
        self.assertIn("fleet.playbook_pool.peak_executing_lte", check_names)
        self.assertIn("fleet.playbook_pool.peak_running_gte", check_names)
        self.assertIn("fleet.playbook_pool.peak_executing_gte", check_names)

    def test_evaluate_expectations_reports_fleet_peak_lower_bound_failures(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "fleet": {
                    "playbook_pool": {
                        "peak_running_gte": 2,
                        "peak_executing_gte": 2,
                    }
                }
            },
            workflow={"state": "completed", "tasks": []},
            board={"ok": True, "data": {"columns": []}},
            work_items={"ok": True, "data": []},
            workspace={"memory": {}, "memory_index": {"keys": []}, "artifact_index": {"items": []}},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={
                "ok": True,
                "data": {
                    "by_playbook_pool": [
                        {
                            "playbook_id": "playbook-1",
                            "max_runtimes": 2,
                            "running": 1,
                            "executing": 1,
                            "active_workflows": 1,
                        }
                    ]
                },
            },
            playbook_id="playbook-1",
            fleet_peaks={"peak_running": 1, "peak_executing": 1, "peak_active_workflows": 1},
        )

        self.assertFalse(result["passed"])
        self.assertIn("expected fleet playbook pool peak_running >= 2, got 1", result["failures"])
        self.assertIn("expected fleet playbook pool peak_executing >= 2, got 1", result["failures"])

    def test_evaluate_expectations_accepts_generic_specialist_pool_fallback(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "fleet": {
                    "playbook_pool": {
                        "max_runtimes": 10,
                        "peak_running_lte": 1,
                        "peak_executing_lte": 1,
                    }
                }
            },
            workflow={"state": "completed", "tasks": []},
            board={"ok": True, "data": {"columns": []}},
            work_items={"ok": True, "data": []},
            workspace={"memory": {}, "memory_index": {"keys": []}, "artifact_index": {"items": []}},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={
                "ok": True,
                "data": {
                    "by_playbook_pool": [
                        {
                            "playbook_id": "specialist",
                            "pool_kind": "specialist",
                            "max_runtimes": 10,
                            "running": 1,
                            "executing": 1,
                            "active_workflows": 0,
                        }
                    ]
                },
            },
            playbook_id="playbook-1",
            fleet_peaks={"peak_running": 1, "peak_executing": 1, "peak_active_workflows": 0},
        )

        self.assertTrue(result["passed"])

    def test_evaluate_expectations_uses_fleet_peaks_without_terminal_pool_entry(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "fleet": {
                    "playbook_pool": {
                        "peak_running_gte": 2,
                        "peak_executing_gte": 2,
                    }
                }
            },
            workflow={"state": "completed", "tasks": []},
            board={"ok": True, "data": {"columns": []}},
            work_items={"ok": True, "data": []},
            workspace={"memory": {}, "memory_index": {"keys": []}, "artifact_index": {"items": []}},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={"ok": True, "data": {"by_playbook_pool": []}},
            playbook_id="playbook-1",
            fleet_peaks={"peak_running": 2, "peak_executing": 2, "peak_active_workflows": 0},
        )

        self.assertTrue(result["passed"])
        check_names = {entry["name"] for entry in result["checks"]}
        self.assertIn("fleet.playbook_pool.peak_running_gte", check_names)
        self.assertIn("fleet.playbook_pool.peak_executing_gte", check_names)

    def test_evaluate_expectations_checks_generic_workflow_fields(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "state": "pending",
                "workflow_fields": {
                    "lifecycle": "ongoing",
                    "current_stage": None,
                },
            },
            workflow={"state": "pending", "lifecycle": "ongoing", "current_stage": None, "tasks": []},
            board={"ok": True, "data": {"columns": []}},
            work_items={"ok": True, "data": []},
            workspace={"memory": {}, "memory_index": {"keys": []}, "artifact_index": {"items": []}},
            artifacts={"ok": True, "data": []},
            approval_actions=[],
            events={"ok": True, "data": []},
            fleet={"ok": True, "data": {"by_playbook_pool": []}},
        )

        self.assertTrue(result["passed"])
        check_names = {entry["name"] for entry in result["checks"]}
        self.assertIn("workflow_fields.lifecycle", check_names)
        self.assertIn("workflow_fields.current_stage", check_names)

    def test_evaluate_expectations_checks_host_directory_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            host_root = Path(tmpdir)
            (host_root / "greet.sh").write_text("#!/usr/bin/env sh\nprintf '%s\\n' 'Hello, Mark!'\n", encoding="utf-8")
            tests_dir = host_root / "tests"
            tests_dir.mkdir()
            (tests_dir / "run.sh").write_text("echo ok\n", encoding="utf-8")

            result = run_workflow_scenario.evaluate_expectations(
                {
                    "host_files": [
                        {"path": "greet.sh", "contains": "Hello, Mark!"},
                        {"path": "tests/run.sh", "contains": "ok"},
                    ]
                },
                workflow={"state": "completed", "tasks": []},
                board={"ok": True, "data": {"columns": []}},
                work_items={"ok": True, "data": []},
                workspace={
                    "memory": {},
                    "settings": {
                        "workspace_storage_type": "host_directory",
                        "workspace_storage": {"host_path": str(host_root), "read_only": False},
                    },
                },
                artifacts={"ok": True, "data": []},
                approval_actions=[],
                events={"ok": True, "data": []},
                fleet={"ok": True, "data": {"by_playbook_pool": []}},
            )

        self.assertTrue(result["passed"])
        check_names = {entry["name"] for entry in result["checks"]}
        self.assertIn("host_files.greet.sh", check_names)
        self.assertIn("host_files.tests/run.sh", check_names)

    def test_update_fleet_peaks_falls_back_to_generic_specialist_pool(self) -> None:
        peaks = {"peak_running": 0, "peak_executing": 0, "peak_active_workflows": 0}

        run_workflow_scenario.update_fleet_peaks(
            peaks,
            {
                "data": {
                    "by_playbook_pool": [
                        {
                            "playbook_id": "specialist",
                            "pool_kind": "specialist",
                            "running": 1,
                            "executing": 1,
                            "active_workflows": 0,
                        }
                    ]
                }
            },
            playbook_id="playbook-1",
        )

        self.assertEqual(
            {"peak_running": 1, "peak_executing": 1, "peak_active_workflows": 0},
            peaks,
        )

    def test_build_workflow_create_payload_includes_required_goal_parameter(self) -> None:
        payload = run_workflow_scenario.build_workflow_create_payload(
            playbook_id="playbook-1",
            workspace_id="workspace-1",
            workflow_name="SDLC Baseline Proof",
            scenario_name="sdlc-baseline",
            workflow_goal="Add support for named greetings and uppercase output while preserving the default greeting.",
            workflow_parameters={"feature_request": "Add named greetings"},
            workflow_metadata={"lane": "repo"},
        )

        self.assertEqual("playbook-1", payload["playbook_id"])
        self.assertEqual("workspace-1", payload["workspace_id"])
        self.assertEqual("SDLC Baseline Proof", payload["name"])
        self.assertEqual(
            {
                "goal": "Add support for named greetings and uppercase output while preserving the default greeting.",
                "scenario_name": "sdlc-baseline",
                "feature_request": "Add named greetings",
            },
            payload["parameters"],
        )
        self.assertEqual(
            {"lane": "repo", "live_test": {"scenario_name": "sdlc-baseline"}},
            payload["metadata"],
        )

    def test_build_create_work_item_payloads_renders_templates(self) -> None:
        payloads = run_workflow_scenario.build_create_work_item_payloads(
            {
                "count": 3,
                "stage_name": "analysis",
                "owner_role": "live-test-burst-specialist",
                "request_id_template": "burst-{index:02d}",
                "title_template": "parallel-burst-{index:02d}",
                "goal_template": "Handle item {index:02d} in workflow {workflow_id}.",
                "acceptance_criteria_template": "Artifact for {scenario_name} item {index:02d} exists.",
                "metadata": {"burst_index": "{index:02d}"},
            },
            workflow_id="wf-1",
            scenario_name="parallel-burst-ten-work-items",
        )

        self.assertEqual(
            [
                {
                    "request_id": "burst-01",
                    "title": "parallel-burst-01",
                    "stage_name": "analysis",
                    "owner_role": "live-test-burst-specialist",
                    "goal": "Handle item 01 in workflow wf-1.",
                    "acceptance_criteria": "Artifact for parallel-burst-ten-work-items item 01 exists.",
                    "metadata": {"burst_index": "01"},
                },
                {
                    "request_id": "burst-02",
                    "title": "parallel-burst-02",
                    "stage_name": "analysis",
                    "owner_role": "live-test-burst-specialist",
                    "goal": "Handle item 02 in workflow wf-1.",
                    "acceptance_criteria": "Artifact for parallel-burst-ten-work-items item 02 exists.",
                    "metadata": {"burst_index": "02"},
                },
                {
                    "request_id": "burst-03",
                    "title": "parallel-burst-03",
                    "stage_name": "analysis",
                    "owner_role": "live-test-burst-specialist",
                    "goal": "Handle item 03 in workflow wf-1.",
                    "acceptance_criteria": "Artifact for parallel-burst-ten-work-items item 03 exists.",
                    "metadata": {"burst_index": "03"},
                },
            ],
            payloads,
        )

    def test_workflow_action_wait_conditions_check_workflow_and_work_item_state(self) -> None:
        ready = run_workflow_scenario.workflow_action_wait_conditions_met(
            {
                "wait_for": {
                    "workflow_state": "pending",
                    "completed_work_items_min": 1,
                    "all_work_items_terminal": True,
                    "total_work_items_min": 1,
                    "open_work_items_max": 0,
                }
            },
            workflow={"state": "pending"},
            work_items_snapshot={
                "ok": True,
                "data": [
                    {"id": "wi-1", "column_id": "released"},
                ],
            },
            board_snapshot={
                "ok": True,
                "data": {"columns": [{"id": "released", "is_terminal": True}], "work_items": []},
            },
        )
        blocked = run_workflow_scenario.workflow_action_wait_conditions_met(
            {
                "wait_for": {
                    "workflow_state": "pending",
                    "completed_work_items_min": 2,
                }
            },
            workflow={"state": "active"},
            work_items_snapshot={
                "ok": True,
                "data": [
                    {"id": "wi-1", "column_id": "released"},
                ],
            },
            board_snapshot={
                "ok": True,
                "data": {"columns": [{"id": "released", "is_terminal": True}], "work_items": []},
            },
        )

        self.assertTrue(ready)
        self.assertFalse(blocked)

    def test_dispatch_workflow_actions_creates_work_items(self) -> None:
        client = FakeClient()
        actions = run_workflow_scenario.dispatch_workflow_actions(
            client,
            workflow_id="wf-1",
            scenario_name="parallel-burst-ten-work-items",
            actions=[
                {
                    "type": "create_work_items",
                    "count": 2,
                    "dispatch": "serial",
                    "stage_name": "analysis",
                    "request_id_template": "burst-{index:02d}",
                    "title_template": "parallel-burst-{index:02d}",
                }
            ],
        )

        self.assertEqual(1, len(actions))
        self.assertEqual("create_work_items", actions[0]["type"])
        self.assertEqual(2, actions[0]["count"])
        self.assertEqual(
            [
                (
                    "POST",
                    "/api/v1/workflows/wf-1/work-items",
                    {
                        "request_id": "burst-01",
                        "title": "parallel-burst-01",
                        "stage_name": "analysis",
                    },
                    (201,),
                    "workflows.work-items.create:burst-01",
                ),
                (
                    "POST",
                    "/api/v1/workflows/wf-1/work-items",
                    {
                        "request_id": "burst-02",
                        "title": "parallel-burst-02",
                        "stage_name": "analysis",
                    },
                    (201,),
                    "workflows.work-items.create:burst-02",
                ),
            ],
            client.calls,
        )

    def test_dispatch_ready_workflow_actions_respects_wait_conditions_between_waves(self) -> None:
        client = FakeClient()
        actions = [
            {
                "type": "create_work_items",
                "count": 1,
                "dispatch": "serial",
                "stage_name": "triage",
                "request_id_template": "wave-1-{index}",
                "title_template": "wave-1-item-{index}",
            },
            {
                "type": "create_work_items",
                "count": 1,
                "dispatch": "serial",
                "stage_name": "triage",
                "request_id_template": "wave-2-{index}",
                "title_template": "wave-2-item-{index}",
                "wait_for": {
                    "workflow_state": "pending",
                    "completed_work_items_min": 1,
                    "all_work_items_terminal": True,
                },
            },
        ]

        next_index, first_wave = run_workflow_scenario.dispatch_ready_workflow_actions(
            client,
            workflow_id="wf-1",
            scenario_name="ongoing-intake-reuse",
            actions=actions,
            next_action_index=0,
            workflow={"state": "pending"},
            work_items_snapshot={"ok": True, "data": []},
            board_snapshot={"ok": True, "data": {"columns": [{"id": "released", "is_terminal": True}], "work_items": []}},
        )
        paused_index, paused_wave = run_workflow_scenario.dispatch_ready_workflow_actions(
            client,
            workflow_id="wf-1",
            scenario_name="ongoing-intake-reuse",
            actions=actions,
            next_action_index=next_index,
            workflow={"state": "active"},
            work_items_snapshot={"ok": True, "data": [{"id": "wi-1", "column_id": "planned"}]},
            board_snapshot={"ok": True, "data": {"columns": [{"id": "released", "is_terminal": True}], "work_items": []}},
        )
        final_index, second_wave = run_workflow_scenario.dispatch_ready_workflow_actions(
            client,
            workflow_id="wf-1",
            scenario_name="ongoing-intake-reuse",
            actions=actions,
            next_action_index=paused_index,
            workflow={"state": "pending"},
            work_items_snapshot={"ok": True, "data": [{"id": "wi-1", "column_id": "released"}]},
            board_snapshot={"ok": True, "data": {"columns": [{"id": "released", "is_terminal": True}], "work_items": []}},
        )

        self.assertEqual(1, next_index)
        self.assertEqual(2, final_index)
        self.assertEqual(1, len(first_wave))
        self.assertEqual([], paused_wave)
        self.assertEqual(1, len(second_wave))
        self.assertEqual(
            [
                (
                    "POST",
                    "/api/v1/workflows/wf-1/work-items",
                    {
                        "request_id": "wave-1-1",
                        "title": "wave-1-item-1",
                        "stage_name": "triage",
                    },
                    (201,),
                    "workflows.work-items.create:wave-1-1",
                ),
                (
                    "POST",
                    "/api/v1/workflows/wf-1/work-items",
                    {
                        "request_id": "wave-2-1",
                        "title": "wave-2-item-1",
                        "stage_name": "triage",
                    },
                    (201,),
                    "workflows.work-items.create:wave-2-1",
                ),
            ],
            client.calls,
        )

    def test_auto_approve_workflow_approvals_posts_once_per_pending_gate(self) -> None:
        client = FakeClient()
        approvals = {
            "task_approvals": [
                {"gate_id": "task-gate-1", "workflow_id": "wf-1", "status": "awaiting_approval", "task_id": "task-1"},
                {"gate_id": "task-gate-1", "workflow_id": "wf-1", "status": "awaiting_approval", "task_id": "task-1"},
                {"gate_id": "task-gate-other", "workflow_id": "wf-2", "status": "awaiting_approval"},
            ],
            "stage_gates": [
                {"gate_id": "stage-gate-1", "workflow_id": "wf-1", "status": "awaiting_approval", "stage_name": "requirements"},
                {"gate_id": "stage-gate-done", "workflow_id": "wf-1", "status": "approved", "stage_name": "release"},
            ],
        }

        seen: set[str] = set()
        actions = run_workflow_scenario.auto_approve_workflow_approvals(
            client,
            approvals,
            workflow_id="wf-1",
            scenario_name="sdlc-baseline",
            approved_gate_ids=seen,
        )

        self.assertEqual(2, len(actions))
        self.assertEqual("task-gate-1", actions[0]["gate_id"])
        self.assertEqual("approve", actions[0]["action"])
        self.assertEqual("task-1", actions[0]["task_id"])
        self.assertIsNone(actions[0]["stage_name"])
        self.assertIsInstance(actions[0]["submitted_at"], str)
        self.assertEqual("stage-gate-1", actions[1]["gate_id"])
        self.assertEqual("approve", actions[1]["action"])
        self.assertIsNone(actions[1]["task_id"])
        self.assertEqual("requirements", actions[1]["stage_name"])
        self.assertIsInstance(actions[1]["submitted_at"], str)
        self.assertEqual({"task-gate-1", "stage-gate-1"}, seen)
        self.assertEqual(
            [
                (
                    "POST",
                    "/api/v1/approvals/task-gate-1",
                    {
                        "request_id": "live-test-sdlc-baseline-approve-task-gate-1",
                        "action": "approve",
                        "feedback": "Approved by the live test operator flow for scenario sdlc-baseline.",
                    },
                    (200,),
                    "approvals.approve:task-gate-1",
                ),
                (
                    "POST",
                    "/api/v1/approvals/stage-gate-1",
                    {
                        "request_id": "live-test-sdlc-baseline-approve-stage-gate-1",
                        "action": "approve",
                        "feedback": "Approved by the live test operator flow for scenario sdlc-baseline.",
                    },
                    (200,),
                    "approvals.approve:stage-gate-1",
                ),
            ],
            client.calls,
        )

    def test_process_workflow_approvals_rejects_pending_gates_in_none_mode(self) -> None:
        client = FakeClient()
        approvals = {
            "task_approvals": [
                {"gate_id": "task-gate-1", "workflow_id": "wf-1", "status": "awaiting_approval"},
            ],
            "stage_gates": [],
        }

        with self.assertRaisesRegex(RuntimeError, "approval_mode=none"):
            run_workflow_scenario.process_workflow_approvals(
                client,
                approvals,
                workflow_id="wf-1",
                scenario_name="sdlc-baseline",
                approved_gate_ids=set(),
                approval_mode="none",
            )

        self.assertEqual([], client.calls)

    def test_process_workflow_approvals_allows_explicit_auto_approval(self) -> None:
        client = FakeClient()
        approvals = {
            "task_approvals": [
                {"gate_id": "task-gate-1", "workflow_id": "wf-1", "status": "awaiting_approval", "task_id": "task-1"},
            ],
            "stage_gates": [],
        }

        actions = run_workflow_scenario.process_workflow_approvals(
            client,
            approvals,
            workflow_id="wf-1",
            scenario_name="approval-positive",
            approved_gate_ids=set(),
            approval_mode="approve_all",
        )

        self.assertEqual(1, len(actions))
        self.assertEqual("task-gate-1", actions[0]["gate_id"])
        self.assertEqual("approve", actions[0]["action"])
        self.assertEqual("task-1", actions[0]["task_id"])
        self.assertIsNone(actions[0]["stage_name"])
        self.assertIsInstance(actions[0]["submitted_at"], str)
        self.assertEqual(1, len(client.calls))

    def test_process_workflow_approvals_applies_scripted_request_changes_then_approve(self) -> None:
        client = FakeClient()
        approvals = {
            "task_approvals": [],
            "stage_gates": [
                {"gate_id": "gate-req-1", "workflow_id": "wf-1", "status": "awaiting_approval", "stage_name": "requirements"},
            ],
        }
        consumed_decisions: set[int] = set()
        approval_decisions = [
            {
                "match": {"stage_name": "requirements"},
                "action": "request_changes",
                "feedback": "Clarify the default greeting behavior before approval.",
            },
            {
                "match": {"stage_name": "requirements"},
                "action": "approve",
            },
        ]

        first_actions = run_workflow_scenario.process_workflow_approvals(
            client,
            approvals,
            workflow_id="wf-1",
            scenario_name="approval-rework",
            approved_gate_ids=set(),
            approval_mode="scripted",
            consumed_decisions=consumed_decisions,
            approval_decisions=approval_decisions,
        )

        self.assertEqual(1, len(first_actions))
        self.assertEqual("gate-req-1", first_actions[0]["gate_id"])
        self.assertEqual("request_changes", first_actions[0]["action"])
        self.assertIsNone(first_actions[0]["task_id"])
        self.assertEqual("requirements", first_actions[0]["stage_name"])
        self.assertIsInstance(first_actions[0]["submitted_at"], str)
        self.assertEqual({0}, consumed_decisions)
        self.assertEqual(
            {
                "request_id": "live-test-approval-rework-request_changes-gate-req-1",
                "action": "request_changes",
                "feedback": "Clarify the default greeting behavior before approval.",
            },
            client.calls[0][2],
        )

        second_actions = run_workflow_scenario.process_workflow_approvals(
            client,
            approvals,
            workflow_id="wf-1",
            scenario_name="approval-rework",
            approved_gate_ids=set(),
            approval_mode="scripted",
            consumed_decisions=consumed_decisions,
            approval_decisions=approval_decisions,
        )

        self.assertEqual(1, len(second_actions))
        self.assertEqual("gate-req-1", second_actions[0]["gate_id"])
        self.assertEqual("approve", second_actions[0]["action"])
        self.assertIsNone(second_actions[0]["task_id"])
        self.assertEqual("requirements", second_actions[0]["stage_name"])
        self.assertIsInstance(second_actions[0]["submitted_at"], str)
        self.assertEqual({0, 1}, consumed_decisions)
        self.assertEqual(
            {
                "request_id": "live-test-approval-rework-approve-gate-req-1",
                "action": "approve",
                "feedback": "Approved by the live test operator flow for scenario approval-rework.",
            },
            client.calls[1][2],
        )

    def test_process_workflow_approvals_fails_when_pending_gate_has_no_matching_scripted_decision(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "no scripted approval decision"):
            run_workflow_scenario.process_workflow_approvals(
                FakeClient(),
                {
                    "task_approvals": [],
                    "stage_gates": [
                        {
                            "gate_id": "gate-release-1",
                            "workflow_id": "wf-1",
                            "status": "awaiting_approval",
                            "stage_name": "release",
                        }
                    ],
                },
                workflow_id="wf-1",
                scenario_name="approval-missing-script",
                approved_gate_ids=set(),
                approval_mode="scripted",
                consumed_decisions=set(),
                approval_decisions=[{"match": {"stage_name": "requirements"}, "action": "approve"}],
            )

    def test_evaluate_expectations_reports_success_when_all_contracts_match(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
                "work_items": {"all_terminal": True, "min_count": 2},
                "board": {"blocked_count": 0},
                "approval_actions": [{"action": "request_changes", "stage_name": "requirements"}],
                "memory": [{"key": "prd_summary", "value": "approved"}],
                "artifacts": [{"logical_path_pattern": "reports/.*\\.md", "min_count": 2}],
                "workflow_tasks": {"min_non_orchestrator_count": 2},
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {"id": "task-1", "is_orchestrator_task": False},
                    {"id": "task-2", "is_orchestrator_task": False},
                ],
            },
            board={"data": {"data": {"columns": [{"id": "blocked"}, {"id": "released", "is_terminal": True}], "work_items": []}}},
            work_items={
                "data": {
                    "data": [
                        {"column_id": "released"},
                        {"column_id": "released"},
                    ]
                }
            },
            workspace={"memory": {"prd_summary": "approved"}},
            artifacts={"data": {"items": [{"logical_path": "reports/findings.md"}, {"logical_path": "reports/summary.md"}]}},
            approval_actions=[{"action": "request_changes", "stage_name": "requirements"}],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])
        self.assertEqual([], verification["failures"])

    def test_evaluate_expectations_reports_contract_failures(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
                "work_items": {"all_terminal": True, "min_count": 2},
                "board": {"blocked_count": 0},
                "approval_actions": [{"action": "request_changes", "stage_name": "requirements"}],
                "memory": [{"key": "prd_summary", "value": "approved"}],
                "artifacts": [{"logical_path_pattern": "reports/.*\\.md", "min_count": 1}],
                "workflow_tasks": {"min_non_orchestrator_count": 2},
            },
            workflow={"state": "failed", "tasks": [{"id": "task-1", "is_orchestrator_task": False}]},
            board={"data": {"data": {"columns": [{"id": "blocked"}, {"id": "released", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "blocked"}]}}},
            work_items={"data": {"data": [{"column_id": "active"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
        )

        self.assertFalse(verification["passed"])
        self.assertGreaterEqual(len(verification["failures"]), 4)

    def test_evaluate_expectations_outcome_driven_mode_passes_with_basic_completion_and_output(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
                "approval_actions": [{"action": "request_changes", "stage_name": "requirements"}],
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                ],
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "done"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": [{"logical_path": "reports/summary.md"}]}},
            approval_actions=[],
            events={"data": {"data": []}},
            evidence={
                "db_state": {"ok": True},
                "runtime_cleanup": {"all_clean": True},
                "log_anomalies": {"rows": []},
            },
            verification_mode="outcome_driven",
        )

        self.assertTrue(verification["passed"])
        self.assertEqual([], verification["failures"])
        self.assertGreaterEqual(len(verification.get("advisories", [])), 1)

    def test_evaluate_expectations_outcome_driven_mode_accepts_allowed_state_envelope(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
                "outcome_envelope": {
                    "allowed_states": ["active", "completed"],
                },
            },
            workflow={
                "state": "active",
                "tasks": [
                    {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                ],
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "done"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": [{"logical_path": "reports/summary.md"}]}},
            approval_actions=[],
            events={"data": {"data": []}},
            evidence={
                "db_state": {"ok": True},
                "runtime_cleanup": {"all_clean": True},
                "log_anomalies": {"rows": []},
            },
            verification_mode="outcome_driven",
        )

        self.assertTrue(verification["passed"])
        state_check = next(check for check in verification["checks"] if check["name"] == "outcome.workflow_state")
        self.assertEqual(["active", "completed"], state_check["expected"])
        self.assertEqual("active", state_check["actual"])

    def test_evaluate_expectations_outcome_driven_mode_accepts_repo_final_artifacts(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
            },
            workflow={
                "state": "completed",
                "orchestration_state": {
                    "final_artifacts": ["briefs/publication-packet.md"],
                },
                "tasks": [
                    {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                ],
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "done"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            evidence={
                "db_state": {"ok": True},
                "runtime_cleanup": {"all_clean": True},
                "log_anomalies": {"rows": []},
            },
            verification_mode="outcome_driven",
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_outcome_driven_mode_requires_basic_sanity(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
            },
            workflow={
                "state": "active",
                "tasks": [
                    {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                ],
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "done"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            evidence={
                "db_state": {"ok": False},
                "runtime_cleanup": {"all_clean": False},
                "log_anomalies": {"rows": [{"level": "error"}]},
            },
            verification_mode="outcome_driven",
        )

        self.assertFalse(verification["passed"])
        self.assertIn("expected workflow state in ['completed'], got 'active'", verification["failures"])
        self.assertIn("expected at least one output artifact for outcome-driven verification", verification["failures"])

    def test_has_fatal_log_anomalies_ignores_task_scoped_recoverable_errors(self) -> None:
        self.assertFalse(
            run_workflow_scenario.has_fatal_log_anomalies(
                {
                    "log_anomalies": {
                        "rows": [
                            {
                                "task_id": "task-1",
                                "level": "error",
                                "operation": "tool.execute",
                                "status": "failed",
                            }
                        ]
                    }
                }
            )
        )

    def test_has_fatal_log_anomalies_keeps_system_level_errors_fatal(self) -> None:
        self.assertTrue(
            run_workflow_scenario.has_fatal_log_anomalies(
                {
                    "log_anomalies": {
                        "rows": [
                            {
                                "level": "error",
                                "operation": "workflow.dispatch",
                                "status": "failed",
                            }
                        ]
                    }
                }
            )
        )

    def test_summarize_http_status_anomalies_counts_client_and_server_errors(self) -> None:
        summary = run_workflow_scenario.summarize_http_status_anomalies(
            {
                "data": [
                    {
                        "level": "error",
                        "error": {
                            "message": "platform api GET /api/v1/tasks failed with status 500 (INTERNAL_ERROR): Internal server error"
                        },
                    },
                    {
                        "level": "warn",
                        "payload": {
                            "error": "platform api POST /api/v1/tasks/123/handoff failed with status 400 (VALIDATION_ERROR): bad request"
                        },
                    },
                    {
                        "level": "warn",
                        "message": "platform api GET /api/v1/tasks/123 failed with status 403 (FORBIDDEN): nope",
                    },
                ]
            }
        )

        self.assertEqual({"400": 1, "403": 1, "500": 1}, summary["status_counts"])
        self.assertEqual(2, summary["client_error_count"])
        self.assertEqual(1, summary["server_error_count"])
        self.assertEqual(3, summary["count"])

    def test_evaluate_expectations_outcome_driven_mode_fails_on_persisted_http_5xx(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                ],
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "done"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": [{"logical_path": "reports/summary.md"}]}},
            approval_actions=[],
            events={"data": {"data": []}},
            evidence={
                "db_state": {"ok": True},
                "runtime_cleanup": {"all_clean": True},
                "log_anomalies": {
                    "rows": [
                        {
                            "task_id": "task-1",
                            "level": "error",
                            "operation": "tool.execute",
                            "status": "failed",
                        }
                    ]
                },
                "http_status_summary": {
                    "status_counts": {"500": 1},
                    "client_error_count": 0,
                    "server_error_count": 1,
                },
            },
            verification_mode="outcome_driven",
        )

        self.assertFalse(verification["passed"])
        self.assertIn("expected persisted execution logs to be free of HTTP 5xx responses", verification["failures"])

    def test_evaluate_expectations_outcome_driven_mode_allows_task_scoped_recoverable_errors(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {"id": "task-1", "is_orchestrator_task": False, "state": "completed"},
                ],
            },
            board={"data": {"data": {"columns": [{"id": "done", "is_terminal": True}], "work_items": [{"id": "wi-1", "column_id": "done"}]}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "done"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": [{"logical_path": "reports/summary.md"}]}},
            approval_actions=[],
            events={"data": {"data": []}},
            evidence={
                "db_state": {"ok": True},
                "runtime_cleanup": {"all_clean": True},
                "log_anomalies": {
                    "rows": [
                        {
                            "task_id": "task-1",
                            "level": "error",
                            "operation": "tool.execute",
                            "status": "failed",
                        }
                    ]
                },
            },
            verification_mode="outcome_driven",
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_uses_authored_terminal_board_columns(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
                "work_items": {"all_terminal": True},
            },
            workflow={"state": "completed", "tasks": []},
            board={"data": {"data": {"columns": [{"id": "released", "is_terminal": True}], "work_items": []}}},
            work_items={"data": {"data": [{"id": "wi-1", "column_id": "released"}]}},
            workspace={},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_rejects_globally_forbidden_task_kinds(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "workflow_tasks": {
                    "min_non_orchestrator_count": 2,
                    "forbid_task_kinds": ["assessment", "approval"],
                }
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-impl-1",
                        "role": "implementation-engineer",
                        "metadata": {"task_kind": "delivery"},
                        "is_orchestrator_task": False,
                    },
                    {
                        "id": "task-review-1",
                        "role": "release-reviewer",
                        "metadata": {"task_kind": "assessment"},
                        "is_orchestrator_task": False,
                    },
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
        )

        self.assertFalse(verification["passed"])
        self.assertIn(
            "expected workflow to avoid task kinds ['approval', 'assessment'], found ['assessment']",
            verification["failures"],
        )

    def test_evaluate_expectations_requires_declared_approval_actions(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "approval_actions": [
                    {"action": "request_changes", "stage_name": "requirements"},
                    {"action": "approve", "stage_name": "requirements"},
                ]
            },
            workflow={"state": "completed"},
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[{"action": "approve", "stage_name": "requirements"}],
            events={"data": {"data": []}},
        )

        self.assertFalse(verification["passed"])
        self.assertEqual(
            [
                "expected approval action {'action': 'request_changes', 'stage_name': 'requirements'} was not observed"
            ],
            verification["failures"],
        )

    def test_evaluate_expectations_accepts_backend_container_log_and_evidence_contracts(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "task_backend_expectations": [
                    {
                        "match": {"is_orchestrator_task": True},
                        "execution_backend": "runtime_only",
                        "used_task_sandbox": False,
                        "min_count": 2,
                    },
                    {
                        "match": {"role": "runtime-split-planning-analyst"},
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": False,
                    },
                    {
                        "match": {"role": "runtime-split-implementation-engineer"},
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": True,
                    },
                    {
                        "match": {"role": "runtime-split-release-coordinator"},
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": False,
                    },
                ],
                "log_row_expectations": [
                    {
                        "match": {
                            "operation": "tool.execute",
                            "status": "completed",
                            "execution_backend": "runtime_plus_task",
                            "tool_owner": "runtime",
                            "payload": {"tool_name": "memory_write"},
                        },
                        "min_count": 2,
                    },
                    {
                        "match": {
                            "operation": "tool.execute",
                            "status": "completed",
                            "execution_backend": "runtime_plus_task",
                            "tool_owner": "task",
                            "payload": {"tool_name": "artifact_upload"},
                        },
                        "min_count": 1,
                    },
                ],
                "container_observation_expectations": [
                    {"match": {"kind": "orchestrator", "execution_backend": "runtime_only"}, "min_count": 1},
                    {"match": {"kind": "runtime", "execution_backend": "runtime_plus_task"}, "min_count": 1},
                    {"match": {"kind": "task", "execution_backend": "runtime_plus_task"}, "min_count": 1},
                ],
                "evidence_expectations": {
                    "db_state_present": True,
                    "runtime_cleanup_passed": True,
                    "docker_log_rotation_passed": True,
                    "log_anomalies_empty": True,
                },
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-orch-1",
                        "role": "orchestrator",
                        "is_orchestrator_task": True,
                        "execution_backend": "runtime_only",
                        "used_task_sandbox": False,
                    },
                    {
                        "id": "task-orch-2",
                        "role": "orchestrator",
                        "is_orchestrator_task": True,
                        "execution_backend": "runtime_only",
                        "used_task_sandbox": False,
                    },
                    {
                        "id": "task-plan-1",
                        "role": "runtime-split-planning-analyst",
                        "is_orchestrator_task": False,
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": False,
                    },
                    {
                        "id": "task-impl-1",
                        "role": "runtime-split-implementation-engineer",
                        "is_orchestrator_task": False,
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": True,
                    },
                    {
                        "id": "task-release-1",
                        "role": "runtime-split-release-coordinator",
                        "is_orchestrator_task": False,
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": False,
                    },
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            execution_logs={
                "data": [
                    {
                        "operation": "tool.execute",
                        "status": "completed",
                        "execution_backend": "runtime_plus_task",
                        "tool_owner": "runtime",
                        "payload": {"tool_name": "memory_write"},
                    },
                    {
                        "operation": "tool.execute",
                        "status": "completed",
                        "execution_backend": "runtime_plus_task",
                        "tool_owner": "runtime",
                        "payload": {"tool_name": "memory_write"},
                    },
                    {
                        "operation": "tool.execute",
                        "status": "completed",
                        "execution_backend": "runtime_plus_task",
                        "tool_owner": "task",
                        "payload": {"tool_name": "artifact_upload"},
                    },
                ]
            },
            evidence={
                "db_state": {"ok": True},
                "runtime_cleanup": {"all_clean": True},
                "docker_log_rotation": {"all_runtime_containers_bounded": True},
                "log_anomalies": {"rows": []},
                "container_observations": {
                    "rows": [
                        {"kind": "orchestrator", "execution_backend": "runtime_only"},
                        {"kind": "runtime", "execution_backend": "runtime_plus_task"},
                        {"kind": "task", "execution_backend": "runtime_plus_task"},
                    ]
                },
            },
        )

        self.assertTrue(verification["passed"])
        self.assertEqual([], verification["failures"])

    def test_evaluate_expectations_reports_backend_and_evidence_contract_failures(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "task_backend_expectations": [
                    {
                        "match": {"role": "runtime-split-implementation-engineer"},
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": True,
                    }
                ],
                "log_row_expectations": [
                    {
                        "match": {
                            "operation": "tool.execute",
                            "status": "completed",
                            "execution_backend": "runtime_plus_task",
                            "tool_owner": "task",
                            "payload": {"tool_name": "artifact_upload"},
                        },
                        "min_count": 1,
                    }
                ],
                "container_observation_expectations": [
                    {"match": {"kind": "task", "execution_backend": "runtime_plus_task"}, "min_count": 1}
                ],
                "evidence_expectations": {
                    "db_state_present": True,
                    "runtime_cleanup_passed": True,
                    "docker_log_rotation_passed": True,
                    "log_anomalies_empty": True,
                },
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-impl-1",
                        "role": "runtime-split-implementation-engineer",
                        "is_orchestrator_task": False,
                        "execution_backend": "runtime_plus_task",
                        "used_task_sandbox": False,
                    }
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            execution_logs={"data": []},
            evidence={
                "db_state": {"ok": False},
                "runtime_cleanup": {"all_clean": False},
                "docker_log_rotation": {"all_runtime_containers_bounded": False},
                "log_anomalies": {"rows": [{"level": "error"}]},
                "container_observations": {"rows": []},
            },
        )

        self.assertFalse(verification["passed"])
        self.assertIn(
            "expected at least 1 task(s) matching {'role': 'runtime-split-implementation-engineer'} with execution_backend='runtime_plus_task' and used_task_sandbox=True, found 0",
            verification["failures"],
        )
        self.assertIn(
            "expected at least 1 execution log row(s) matching {'operation': 'tool.execute', 'status': 'completed', 'execution_backend': 'runtime_plus_task', 'tool_owner': 'task', 'payload': {'tool_name': 'artifact_upload'}}, found 0",
            verification["failures"],
        )
        self.assertIn(
            "expected at least 1 observed live container row(s) matching {'kind': 'task', 'execution_backend': 'runtime_plus_task'}, found 0",
            verification["failures"],
        )
        self.assertIn("expected DB evidence to be present", verification["failures"])
        self.assertIn("expected runtime cleanup evidence to pass", verification["failures"])
        self.assertIn("expected Docker log rotation evidence to pass", verification["failures"])
        self.assertIn("expected execution-log anomaly review to be empty", verification["failures"])

    def test_evaluate_expectations_enforces_distinct_orchestrator_runtime_minimum(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "state": "completed",
                "evidence_expectations": {
                    "distinct_orchestrator_runtime_count_min": 2,
                },
            },
            workflow={"state": "completed", "tasks": []},
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            execution_logs={
                "data": [
                    {"operation": "task.execute", "role": "orchestrator", "actor_name": "orch-a"},
                    {"operation": "task.execute", "role": "orchestrator", "actor_name": "orch-a"},
                ]
            },
            evidence={},
            verification_mode=run_workflow_scenario.OUTCOME_DRIVEN_VERIFICATION_MODE,
        )

        self.assertFalse(verification["passed"])
        self.assertIn(
            "expected at least 2 distinct orchestrator runtime actor(s), found 1",
            verification["failures"],
        )

    def test_evaluate_expectations_accepts_generic_assessment_contracts(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "direct_handoff_expectations": [
                    {
                        "source_role": "author",
                        "successor_role": "packager",
                        "forbid_task_kinds": ["assessment", "approval"],
                    }
                ],
                "assessment_sequences": [
                    {
                        "subject_task_id": "task-build-1",
                        "assessed_by": "checker",
                        "expected_resolution": "approved",
                        "subject_revision": 2,
                    },
                    {
                        "subject_task_id": "task-build-1",
                        "assessed_by": "auditor",
                        "expected_resolution": "approved",
                        "subject_revision": 2,
                    },
                ],
                "approval_sequences": [
                    {
                        "match": {"stage_name": "approve-gate"},
                        "expected_actions": ["request_changes", "approve"],
                    }
                ],
                "subject_revision_expectations": [
                    {"stage_name": "implementation", "current_revision": 2}
                ],
                "required_assessment_sets": [
                    {
                        "subject_task_id": "task-build-1",
                        "subject_revision": 2,
                        "required_assessors": ["checker", "auditor"],
                    }
                ],
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-author-1",
                        "role": "author",
                        "stage_name": "draft",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-21T09:00:00Z",
                    },
                    {
                        "id": "task-packager-1",
                        "role": "packager",
                        "stage_name": "publish",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-21T09:05:00Z",
                    },
                    {
                        "id": "task-build-1",
                        "role": "builder",
                        "stage_name": "implementation",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-21T10:00:00Z",
                    },
                    {
                        "id": "task-check-1",
                        "role": "checker",
                        "stage_name": "assessment",
                        "input": {"subject_task_id": "task-build-1", "subject_revision": 2},
                        "metadata": {
                            "task_kind": "assessment",
                            "subject_task_id": "task-build-1",
                            "subject_revision": 2,
                        },
                        "output": {"resolution": "approved"},
                        "completed_at": "2026-03-21T10:10:00Z",
                    },
                    {
                        "id": "task-audit-1",
                        "role": "auditor",
                        "stage_name": "assessment",
                        "input": {"subject_task_id": "task-build-1", "subject_revision": 2},
                        "metadata": {
                            "task_kind": "assessment",
                            "subject_task_id": "task-build-1",
                            "subject_revision": 2,
                        },
                        "output": {"resolution": "approved"},
                        "completed_at": "2026-03-21T10:12:00Z",
                    },
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={
                "data": {
                    "data": [{"id": "wi-impl-1", "stage_name": "implementation", "current_subject_revision": 2}]
                }
            },
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[
                {"stage_name": "approve-gate", "action": "request_changes"},
                {"stage_name": "approve-gate", "action": "approve"},
            ],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])
        self.assertEqual([], verification["failures"])
        self.assertEqual(
            {
                "direct_handoff_expectations:author->packager",
                "assessment_sequences:task-build-1:checker",
                "assessment_sequences:task-build-1:auditor",
                "approval_sequences:{'stage_name': 'approve-gate'}",
                "subject_revision_expectations:implementation",
                "required_assessment_sets:task-build-1",
            },
            {check["name"] for check in verification["checks"]},
        )

    def test_evaluate_expectations_accepts_assessment_tasks_declared_via_metadata_task_type(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "assessment_sequences": [
                    {
                        "subject_role": "implementation-engineer",
                        "assessed_by": "acceptance-gate-assessor",
                        "expected_resolution": "approved",
                        "subject_revision": 1,
                    }
                ],
                "required_assessment_sets": [
                    {
                        "subject_role": "implementation-engineer",
                        "subject_revision": 1,
                        "required_assessors": ["acceptance-gate-assessor"],
                    }
                ],
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-impl-1",
                        "role": "implementation-engineer",
                        "stage_name": "implementation",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-22T03:40:00Z",
                    },
                    {
                        "id": "task-assess-1",
                        "role": "acceptance-gate-assessor",
                        "stage_name": "assessment",
                        "input": {"subject_task_id": "task-impl-1", "subject_revision": 1},
                        "metadata": {
                            "task_type": "assessment",
                            "subject_task_id": "task-impl-1",
                            "subject_revision": 1,
                        },
                        "output": {"resolution": "approved"},
                        "completed_at": "2026-03-22T03:41:00Z",
                    },
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])
        self.assertEqual([], verification["failures"])

    def test_evaluate_expectations_reads_assessment_resolution_from_submitted_handoff(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "assessment_sequences": [
                    {
                        "subject_role": "implementation-engineer",
                        "assessed_by": "acceptance-gate-assessor",
                        "expected_resolution": "approved",
                        "subject_revision": 1,
                    }
                ],
                "required_assessment_sets": [
                    {
                        "subject_role": "implementation-engineer",
                        "subject_revision": 1,
                        "required_assessors": ["acceptance-gate-assessor"],
                    }
                ],
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-impl-1",
                        "role": "implementation-engineer",
                        "stage_name": "implementation",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-22T03:40:00Z",
                    },
                    {
                        "id": "task-assess-1",
                        "role": "acceptance-gate-assessor",
                        "stage_name": "implementation",
                        "input": {"subject_task_id": "task-impl-1", "subject_revision": 1},
                        "metadata": {
                            "task_type": "assessment",
                            "subject_task_id": "task-impl-1",
                            "subject_revision": 1,
                        },
                        "output": {
                            "raw": {
                                "loop": {
                                    "iterations": [
                                        {
                                            "act": [
                                                {
                                                    "step": {"tool": "submit_handoff"},
                                                    "output": json.dumps(
                                                        {
                                                            "completion": "full",
                                                            "resolution": "approved",
                                                            "role_data": {
                                                                "task_kind": "assessment",
                                                                "subject_task_id": "task-impl-1",
                                                                "subject_revision": 1,
                                                            },
                                                        }
                                                    ),
                                                }
                                            ]
                                        }
                                    ]
                                }
                            }
                        },
                        "completed_at": "2026-03-22T03:41:00Z",
                    },
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])
        self.assertEqual([], verification["failures"])

    def test_evaluate_expectations_reports_generic_assessment_contract_failures(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "direct_handoff_expectations": [
                    {
                        "source_role": "author",
                        "successor_role": "packager",
                        "forbid_task_kinds": ["assessment"],
                    }
                ],
                "assessment_sequences": [
                    {
                        "subject_task_id": "task-build-1",
                        "assessed_by": "checker",
                        "expected_actions": ["request_changes", "approved"],
                        "subject_revision": 2,
                    }
                ],
                "approval_sequences": [
                    {
                        "match": {"stage_name": "approve-gate"},
                        "expected_actions": ["request_changes", "approve"],
                    }
                ],
                "subject_revision_expectations": [
                    {"stage_name": "implementation", "current_revision": 2}
                ],
                "required_assessment_sets": [
                    {
                        "subject_task_id": "task-build-1",
                        "subject_revision": 2,
                        "required_assessors": ["checker", "auditor"],
                    }
                ],
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-author-1",
                        "role": "author",
                        "stage_name": "draft",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-21T09:00:00Z",
                    },
                    {
                        "id": "task-packager-1",
                        "role": "packager",
                        "stage_name": "publish",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-21T09:05:00Z",
                    },
                    {
                        "id": "task-extra-assessment-1",
                        "role": "checker",
                        "stage_name": "assessment",
                        "input": {"subject_task_id": "task-author-1", "subject_revision": 1},
                        "metadata": {
                            "task_kind": "assessment",
                            "subject_task_id": "task-author-1",
                            "subject_revision": 1,
                        },
                        "output": {"resolution": "approved"},
                        "completed_at": "2026-03-21T09:02:00Z",
                    },
                    {
                        "id": "task-build-1",
                        "role": "builder",
                        "stage_name": "implementation",
                        "metadata": {"task_kind": "delivery"},
                        "completed_at": "2026-03-21T10:00:00Z",
                    },
                    {
                        "id": "task-check-1",
                        "role": "checker",
                        "stage_name": "assessment",
                        "input": {"subject_task_id": "task-build-1", "subject_revision": 1},
                        "metadata": {
                            "task_kind": "assessment",
                            "subject_task_id": "task-build-1",
                            "subject_revision": 1,
                        },
                        "output": {"resolution": "approved"},
                        "completed_at": "2026-03-21T10:10:00Z",
                    },
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={
                "data": {
                    "data": [{"id": "wi-impl-1", "stage_name": "implementation", "current_subject_revision": 1}]
                }
            },
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[{"stage_name": "approve-gate", "action": "approve"}],
            events={"data": {"data": []}},
        )

        self.assertFalse(verification["passed"])
        self.assertEqual(
            [
                "expected direct handoff author->packager without linked assessment, found blocking assessment task kinds ['assessment']",
                "expected assessment sequence for subject 'task-build-1' by assessor 'checker' to equal ['request_changes', 'approved'], got []",
                "expected approval sequence for match {'stage_name': 'approve-gate'} to equal ['request_changes', 'approve'], got ['approve']",
                "expected subject revision for stage 'implementation' to equal 2, got 1",
                "expected required assessors ['checker', 'auditor'] for subject 'task-build-1' revision 2, missing ['checker', 'auditor']",
            ],
            verification["failures"],
        )

    def test_evaluate_expectations_requires_rework_between_request_changes_and_approve(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "gate_rework_sequences": [
                    {
                        "stage_name": "release",
                        "request_action": "request_changes",
                        "resume_action": "approve",
                        "required_event_type": "task.handoff_submitted",
                        "required_role": "live-test-architect",
                    }
                ]
            },
            workflow={"state": "completed"},
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={
                "data": {
                    "data": [
                        {
                            "type": "stage.gate.request_changes",
                            "created_at": "2026-03-19T03:00:00Z",
                            "data": {"stage_name": "release"},
                        },
                        {
                            "type": "task.handoff_submitted",
                            "created_at": "2026-03-19T03:05:00Z",
                            "data": {"stage_name": "release", "role": "live-test-architect"},
                        },
                        {
                            "type": "stage.gate.approve",
                            "created_at": "2026-03-19T03:10:00Z",
                            "data": {"stage_name": "release"},
                        },
                    ]
                }
            },
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_fails_when_gate_is_reapproved_without_rework(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "gate_rework_sequences": [
                    {
                        "stage_name": "release",
                        "request_action": "request_changes",
                        "resume_action": "approve",
                        "required_event_type": "task.handoff_submitted",
                        "required_role": "live-test-architect",
                    }
                ]
            },
            workflow={"state": "completed"},
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={
                "data": {
                    "data": [
                        {
                            "type": "stage.gate.request_changes",
                            "created_at": "2026-03-19T03:00:00Z",
                            "data": {"stage_name": "release"},
                        },
                        {
                            "type": "stage.gate.approve",
                            "created_at": "2026-03-19T03:10:00Z",
                            "data": {"stage_name": "release"},
                        },
                    ]
                }
            },
        )

        self.assertFalse(verification["passed"])
        self.assertEqual(
            [
                "expected 'task.handoff_submitted' for rework stage 'release' after gate stage 'release' between stage.gate.request_changes and stage.gate.approve"
            ],
            verification["failures"],
        )

    def test_evaluate_expectations_accepts_completed_rework_task_between_gate_events(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "gate_rework_sequences": [
                    {
                        "stage_name": "release",
                        "request_action": "request_changes",
                        "resume_action": "approve",
                        "required_event_type": "task.handoff_submitted",
                        "required_role": "live-test-architect",
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-release-rework",
                        "role": "live-test-architect",
                        "stage_name": "release",
                        "completed_at": "2026-03-19T03:05:00Z",
                    }
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={
                "data": {
                    "data": [
                        {
                            "type": "stage.gate.request_changes",
                            "created_at": "2026-03-19T03:00:00Z",
                            "data": {"stage_name": "release"},
                        },
                        {
                            "type": "stage.gate.approve",
                            "created_at": "2026-03-19T03:10:00Z",
                            "data": {"stage_name": "release"},
                        },
                    ]
                }
            },
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_accepts_rework_between_scripted_approval_actions(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "gate_rework_sequences": [
                    {
                        "stage_name": "approval-gate",
                        "request_action": "request_changes",
                        "resume_action": "approve",
                        "required_event_type": "task.handoff_submitted",
                        "required_role": "rework-product-strategist",
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-approval-gate-rework",
                        "role": "rework-product-strategist",
                        "stage_name": "approval-gate",
                        "completed_at": "2026-03-19T03:05:00Z",
                    }
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[
                {
                    "stage_name": "approval-gate",
                    "action": "request_changes",
                    "submitted_at": "2026-03-19T03:00:00Z",
                },
                {
                    "stage_name": "approval-gate",
                    "action": "approve",
                    "submitted_at": "2026-03-19T03:10:00Z",
                },
            ],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_accepts_rework_between_scripted_approval_actions_with_explicit_task_load(
        self,
    ) -> None:
        client = FakeWorkflowClient(
            [
                {
                    "data": [
                        {
                            "id": "task-approval-gate-rework",
                            "role": "rework-product-strategist",
                            "stage_name": "approval-gate",
                            "completed_at": "2026-03-19T03:05:00Z",
                        }
                    ],
                    "meta": {"page": 1, "pages": 1, "per_page": 100, "total": 1},
                }
            ]
        )
        workflow = run_workflow_scenario.attach_workflow_tasks(
            {"state": "completed"},
            run_workflow_scenario.fetch_workflow_tasks(client, workflow_id="wf-1"),
        )

        verification = run_workflow_scenario.evaluate_expectations(
            {
                "gate_rework_sequences": [
                    {
                        "stage_name": "approval-gate",
                        "request_action": "request_changes",
                        "resume_action": "approve",
                        "required_event_type": "task.handoff_submitted",
                        "required_role": "rework-product-strategist",
                    }
                ]
            },
            workflow=workflow,
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[
                {
                    "stage_name": "approval-gate",
                    "action": "request_changes",
                    "submitted_at": "2026-03-19T03:00:00Z",
                },
                {
                    "stage_name": "approval-gate",
                    "action": "approve",
                    "submitted_at": "2026-03-19T03:10:00Z",
                },
            ],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_accepts_gate_rework_in_a_different_stage(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "gate_rework_sequences": [
                    {
                        "stage_name": "approval-gate",
                        "rework_stage_name": "drafting",
                        "request_action": "request_changes",
                        "resume_action": "approve",
                        "required_event_type": "task.handoff_submitted",
                        "required_role": "rework-technical-editor",
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-drafting-rework",
                        "role": "rework-technical-editor",
                        "stage_name": "drafting",
                        "completed_at": "2026-03-19T03:05:00Z",
                    }
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[
                {
                    "stage_name": "approval-gate",
                    "action": "request_changes",
                    "submitted_at": "2026-03-19T03:00:00Z",
                },
                {
                    "stage_name": "approval-gate",
                    "action": "approve",
                    "submitted_at": "2026-03-19T03:10:00Z",
                },
            ],
            events={"data": {"data": []}},
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_requires_specialist_rework_between_assessment_events(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "task_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "request_event_type": "task.assessment_requested_changes",
                        "resume_event_type": "task.approved",
                        "required_role": "live-test-developer",
                    }
                ]
            },
            workflow={"state": "completed"},
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={
                "data": {
                    "data": [
                        {
                            "type": "task.assessment_requested_changes",
                            "created_at": "2026-03-19T04:00:00Z",
                            "data": {"stage_name": "implementation", "task_role": "live-test-reviewer"},
                        },
                        {
                            "type": "task.handoff_submitted",
                            "created_at": "2026-03-19T04:05:00Z",
                            "data": {"stage_name": "implementation", "role": "live-test-developer"},
                        },
                        {
                            "type": "task.approved",
                            "created_at": "2026-03-19T04:10:00Z",
                            "data": {"stage_name": "implementation", "task_role": "live-test-reviewer"},
                        },
                    ]
                }
            },
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_accepts_continuity_backed_rework_sequence(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "continuity_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "required_role": "live-test-developer",
                        "assessment_stage_name": "review",
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-dev-1",
                        "stage_name": "implementation",
                        "role": "live-test-developer",
                        "completed_at": "2026-03-19T04:20:00Z",
                    }
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={
                "data": {
                    "data": [
                        {
                            "id": "wi-impl-1",
                            "stage_name": "implementation",
                            "rework_count": 1,
                        },
                        {
                            "id": "wi-review-1",
                            "stage_name": "review",
                            "parent_work_item_id": "wi-impl-1",
                            "task_count": 2,
                        },
                    ]
                }
            },
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            execution_logs={
                "data": [
                    {
                        "operation": "work_item.continuity.assessment_requested_changes",
                        "work_item_id": "wi-impl-1",
                        "created_at": "2026-03-19T04:10:00Z",
                    }
                ]
            },
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_accepts_continuity_rework_on_same_work_item(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "continuity_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "required_role": "live-test-developer",
                        "assessment_stage_name": "implementation",
                        "assessment_task_min_count": 2,
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-dev-1",
                        "stage_name": "implementation",
                        "role": "live-test-developer",
                        "work_item_id": "wi-impl-1",
                        "completed_at": "2026-03-19T04:20:00Z",
                    },
                    {
                        "id": "task-assess-1",
                        "stage_name": "implementation",
                        "role": "live-test-assessor",
                        "work_item_id": "wi-impl-1",
                        "completed_at": "2026-03-19T04:12:00Z",
                        "input": {
                            "subject_task_id": "task-dev-1",
                            "subject_revision": 1,
                        },
                        "metadata": {
                            "task_kind": "assessment",
                            "subject_task_id": "task-dev-1",
                            "subject_revision": 1,
                        },
                    },
                    {
                        "id": "task-assess-2",
                        "stage_name": "implementation",
                        "role": "live-test-assessor",
                        "work_item_id": "wi-impl-1",
                        "completed_at": "2026-03-19T04:18:00Z",
                        "input": {
                            "subject_task_id": "task-dev-1",
                            "subject_revision": 2,
                        },
                        "metadata": {
                            "task_kind": "assessment",
                            "subject_task_id": "task-dev-1",
                            "subject_revision": 2,
                        },
                    },
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={
                "data": {
                    "data": [
                        {
                            "id": "wi-impl-1",
                            "stage_name": "implementation",
                            "rework_count": 1,
                            "task_count": 3,
                        }
                    ]
                }
            },
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            execution_logs={
                "data": [
                    {
                        "operation": "work_item.continuity.assessment_requested_changes",
                        "work_item_id": "wi-impl-1",
                        "created_at": "2026-03-19T04:10:00Z",
                    }
                ]
            },
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_accepts_continuity_backed_double_rework_sequence(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "continuity_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "required_role": "live-test-developer",
                        "minimum_rework_count": 2,
                        "assessment_stage_name": "review",
                        "assessment_task_min_count": 3,
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-dev-1",
                        "stage_name": "implementation",
                        "role": "live-test-developer",
                        "completed_at": "2026-03-19T04:20:00Z",
                    }
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={
                "data": {
                    "data": [
                        {
                            "id": "wi-impl-1",
                            "stage_name": "implementation",
                            "rework_count": 2,
                        },
                        {
                            "id": "wi-review-1",
                            "stage_name": "review",
                            "parent_work_item_id": "wi-impl-1",
                            "task_count": 3,
                        },
                    ]
                }
            },
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            execution_logs={
                "data": [
                    {
                        "operation": "work_item.continuity.assessment_requested_changes",
                        "work_item_id": "wi-impl-1",
                        "created_at": "2026-03-19T04:10:00Z",
                    },
                    {
                        "operation": "work_item.continuity.assessment_requested_changes",
                        "work_item_id": "wi-impl-1",
                        "created_at": "2026-03-19T04:15:00Z",
                    }
                ]
            },
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_fails_when_assessment_is_reapproved_without_specialist_rework(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "task_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "request_event_type": "task.assessment_requested_changes",
                        "resume_event_type": "task.approved",
                        "required_role": "live-test-developer",
                    }
                ]
            },
            workflow={"state": "completed"},
            board={"data": {"data": {"columns": []}}},
            work_items={"data": {"data": []}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={
                "data": {
                    "data": [
                        {
                            "type": "task.assessment_requested_changes",
                            "created_at": "2026-03-19T04:00:00Z",
                            "data": {"stage_name": "implementation", "task_role": "live-test-reviewer"},
                        },
                        {
                            "type": "task.approved",
                            "created_at": "2026-03-19T04:10:00Z",
                            "data": {"stage_name": "implementation", "task_role": "live-test-reviewer"},
                        },
                    ]
                }
            },
        )

        self.assertFalse(verification["passed"])
        self.assertEqual(
            [
                "expected specialist rework for stage 'implementation' between "
                "'task.assessment_requested_changes' and 'task.approved'"
            ],
            verification["failures"],
        )

    def test_evaluate_expectations_fails_when_continuity_rework_is_missing(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "continuity_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "required_role": "live-test-developer",
                    }
                ]
            },
            workflow={
                "state": "completed",
                "tasks": [
                    {
                        "id": "task-dev-1",
                        "stage_name": "implementation",
                        "role": "live-test-developer",
                        "completed_at": "2026-03-19T04:05:00Z",
                    }
                ],
            },
            board={"data": {"data": {"columns": []}}},
            work_items={
                "data": {
                    "data": [
                        {
                            "id": "wi-impl-1",
                            "stage_name": "implementation",
                            "rework_count": 1,
                        },
                        {
                            "id": "wi-review-1",
                            "stage_name": "review",
                            "parent_work_item_id": "wi-impl-1",
                            "task_count": 1,
                        },
                    ]
                }
            },
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
            execution_logs={
                "data": [
                    {
                        "operation": "work_item.continuity.assessment_requested_changes",
                        "work_item_id": "wi-impl-1",
                        "created_at": "2026-03-19T04:10:00Z",
                    }
                ]
            },
        )

        self.assertFalse(verification["passed"])
        self.assertEqual(
            [
                "expected continuity-backed rework for stage 'implementation' "
                "with role 'live-test-developer'"
            ],
            verification["failures"],
        )

    def test_collect_workflow_events_pages_until_has_more_is_false(self) -> None:
        client = FakePagedClient(
            [
                {
                    "ok": True,
                    "data": {
                        "data": [{"id": 300, "type": "stage.gate.request_changes"}],
                        "meta": {"has_more": True, "next_after": "300"},
                    },
                },
                {
                    "ok": True,
                    "data": {
                        "data": [{"id": 200, "type": "task.handoff_submitted"}],
                        "meta": {"has_more": False, "next_after": None},
                    },
                },
            ]
        )

        snapshot = run_workflow_scenario.collect_workflow_events(client, workflow_id="wf-1")

        self.assertEqual(
            {
                "ok": True,
                "data": {
                    "data": [
                        {"id": 300, "type": "stage.gate.request_changes"},
                        {"id": 200, "type": "task.handoff_submitted"},
                    ],
                    "meta": {"has_more": False, "next_after": None},
                },
            },
            snapshot,
        )
        self.assertEqual(
            [
                ("GET", "/api/v1/workflows/wf-1/events?limit=100", None, (200,), "workflows.events"),
                ("GET", "/api/v1/workflows/wf-1/events?limit=100&after=300", None, (200,), "workflows.events"),
            ],
            client.calls,
        )

    def test_collect_workflow_events_returns_first_error_without_follow_up_requests(self) -> None:
        client = FakePagedClient(
            [
                {
                    "ok": False,
                    "error": "GET /api/v1/workflows/wf-1/events?limit=100 returned 400",
                }
            ]
        )

        snapshot = run_workflow_scenario.collect_workflow_events(client, workflow_id="wf-1")

        self.assertEqual(
            {
                "ok": False,
                "error": "GET /api/v1/workflows/wf-1/events?limit=100 returned 400",
            },
            snapshot,
        )
        self.assertEqual(
            [("GET", "/api/v1/workflows/wf-1/events?limit=100", None, (200,), "workflows.events")],
            client.calls,
        )


if __name__ == "__main__":
    unittest.main()
