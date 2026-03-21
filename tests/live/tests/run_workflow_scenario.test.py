#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
import os
import json
from pathlib import Path


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
        return {"data": {"gate_id": path.rsplit("/", 1)[-1], "status": "approved"}}


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
    def test_default_final_settle_window_covers_one_minute(self) -> None:
        self.assertEqual(60, run_workflow_scenario.DEFAULT_FINAL_SETTLE_ATTEMPTS)
        self.assertEqual(1, run_workflow_scenario.DEFAULT_FINAL_SETTLE_DELAY_SECONDS)

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

    def test_build_run_result_payload_includes_explicit_scenario_and_provider_mode(self) -> None:
        payload = run_workflow_scenario.build_run_result_payload(
            workflow_id="wf-1",
            final_state="completed",
            timed_out=False,
            poll_iterations=7,
            scenario_name="sdlc-lite-approval-request-changes-then-approve",
            approval_mode="scripted",
            provider_auth_mode="oauth",
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
                "specialist_teardown": {"max_lag_seconds": 1.2},
            },
            verification={"passed": True, "failures": [], "checks": []},
        )

        self.assertEqual("sdlc-lite-approval-request-changes-then-approve", payload["scenario"])
        self.assertEqual("sdlc-lite-approval-request-changes-then-approve", payload["scenario_name"])
        self.assertEqual("oauth", payload["provider_auth_mode"])
        self.assertEqual("completed", payload["workflow_state"])
        self.assertTrue(payload["verification_passed"])
        self.assertFalse(payload["harness_failure"])
        self.assertEqual(12.5, payload["workflow_duration_seconds"])
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

    def test_evaluate_expectations_checks_efficiency_thresholds(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {
                "efficiency": {
                    "workflow_duration_seconds_lte": 60,
                    "non_orchestrator_max_llm_turns_lte": 3,
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
        self.assertIn("efficiency.specialist_teardown_lag_seconds_lte", check_names)

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
                    {"id": "wi-1", "column_id": "done"},
                ],
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
                    {"id": "wi-1", "column_id": "done"},
                ],
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
        )
        paused_index, paused_wave = run_workflow_scenario.dispatch_ready_workflow_actions(
            client,
            workflow_id="wf-1",
            scenario_name="ongoing-intake-reuse",
            actions=actions,
            next_action_index=next_index,
            workflow={"state": "active"},
            work_items_snapshot={"ok": True, "data": [{"id": "wi-1", "column_id": "planned"}]},
        )
        final_index, second_wave = run_workflow_scenario.dispatch_ready_workflow_actions(
            client,
            workflow_id="wf-1",
            scenario_name="ongoing-intake-reuse",
            actions=actions,
            next_action_index=paused_index,
            workflow={"state": "pending"},
            work_items_snapshot={"ok": True, "data": [{"id": "wi-1", "column_id": "done"}]},
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
            board={"data": {"data": {"columns": [{"id": "blocked", "work_items": []}]}}},
            work_items={
                "data": {
                    "data": [
                        {"column_id": "done"},
                        {"column_id": "done"},
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
            board={"data": {"data": {"columns": [{"id": "blocked", "work_items": [{"id": "wi-1"}]}]}}},
            work_items={"data": {"data": [{"column_id": "active"}]}},
            workspace={"memory": {}},
            artifacts={"data": {"items": []}},
            approval_actions=[],
            events={"data": {"data": []}},
        )

        self.assertFalse(verification["passed"])
        self.assertGreaterEqual(len(verification["failures"]), 4)

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
                "expected 'task.handoff_submitted' for stage 'release' between stage.gate.request_changes and stage.gate.approve"
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

    def test_evaluate_expectations_requires_specialist_rework_between_review_events(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "task_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "request_event_type": "task.review_requested_changes",
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
                            "type": "task.review_requested_changes",
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
                        "operation": "work_item.continuity.review_rejected",
                        "work_item_id": "wi-impl-1",
                        "created_at": "2026-03-19T04:10:00Z",
                    }
                ]
            },
        )

        self.assertTrue(verification["passed"])

    def test_evaluate_expectations_fails_when_review_is_reapproved_without_specialist_rework(self) -> None:
        verification = run_workflow_scenario.evaluate_expectations(
            {
                "task_rework_sequences": [
                    {
                        "stage_name": "implementation",
                        "request_event_type": "task.review_requested_changes",
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
                            "type": "task.review_requested_changes",
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
                "'task.review_requested_changes' and 'task.approved'"
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
                        "operation": "work_item.continuity.review_rejected",
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
