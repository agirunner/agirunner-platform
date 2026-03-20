#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
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

    def test_build_run_result_payload_includes_explicit_scenario_and_provider_mode(self) -> None:
        payload = run_workflow_scenario.build_run_result_payload(
            workflow_id="wf-1",
            final_state="completed",
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
            verification={"passed": True, "failures": [], "checks": []},
        )

        self.assertEqual("sdlc-lite-approval-request-changes-then-approve", payload["scenario"])
        self.assertEqual("sdlc-lite-approval-request-changes-then-approve", payload["scenario_name"])
        self.assertEqual("oauth", payload["provider_auth_mode"])
        self.assertEqual("completed", payload["workflow_state"])

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

        self.assertEqual(
            [
                {"gate_id": "task-gate-1", "action": "approve", "task_id": "task-1", "stage_name": None},
                {"gate_id": "stage-gate-1", "action": "approve", "task_id": None, "stage_name": "requirements"},
            ],
            actions,
        )
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

        self.assertEqual(
            [{"gate_id": "task-gate-1", "action": "approve", "task_id": "task-1", "stage_name": None}],
            actions,
        )
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

        self.assertEqual(
            [{"gate_id": "gate-req-1", "action": "request_changes", "task_id": None, "stage_name": "requirements"}],
            first_actions,
        )
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

        self.assertEqual(
            [{"gate_id": "gate-req-1", "action": "approve", "task_id": None, "stage_name": "requirements"}],
            second_actions,
        )
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
