#!/usr/bin/env python3
from __future__ import annotations

import sys
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


class RunWorkflowScenarioTests(unittest.TestCase):
    def test_build_workflow_create_payload_includes_required_goal_parameter(self) -> None:
        payload = run_workflow_scenario.build_workflow_create_payload(
            playbook_id="playbook-1",
            workspace_id="workspace-1",
            workflow_name="SDLC Baseline Proof",
            scenario_name="sdlc-baseline",
            workflow_goal="Add support for named greetings and uppercase output while preserving the default greeting.",
            workflow_parameters={"feature_request": "Add named greetings"},
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
            {"live_test": {"scenario_name": "sdlc-baseline"}},
            payload["metadata"],
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
                "work_items": {"all_terminal": True},
                "board": {"blocked_count": 0},
                "approval_actions": [{"action": "request_changes", "stage_name": "requirements"}],
                "memory": [{"key": "prd_summary", "value": "approved"}],
                "artifacts": [{"logical_path_pattern": "reports/.*\\.md", "min_count": 2}],
            },
            workflow={"state": "completed"},
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
                "work_items": {"all_terminal": True},
                "board": {"blocked_count": 0},
                "approval_actions": [{"action": "request_changes", "stage_name": "requirements"}],
                "memory": [{"key": "prd_summary", "value": "approved"}],
                "artifacts": [{"logical_path_pattern": "reports/.*\\.md", "min_count": 1}],
            },
            workflow={"state": "failed"},
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


if __name__ == "__main__":
    unittest.main()
