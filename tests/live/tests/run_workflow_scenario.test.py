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
        )

        self.assertEqual("playbook-1", payload["playbook_id"])
        self.assertEqual("workspace-1", payload["workspace_id"])
        self.assertEqual("SDLC Baseline Proof", payload["name"])
        self.assertEqual(
            {
                "goal": "Add support for named greetings and uppercase output while preserving the default greeting.",
                "scenario_name": "sdlc-baseline",
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


if __name__ == "__main__":
    unittest.main()
