#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from operator_flow import submit_pending_operator_approvals, submit_ready_steering_requests


class FakeRunApi:
    def __init__(self) -> None:
        self.approval_calls: list[dict[str, str]] = []
        self.steering_calls: list[dict[str, str | None]] = []

    def submit_approval(
        self,
        gate_id: str,
        *,
        request_id: str,
        action: str,
        feedback: str,
    ) -> dict[str, str]:
        payload = {
            "gate_id": gate_id,
            "request_id": request_id,
            "action": action,
            "feedback": feedback,
        }
        self.approval_calls.append(payload)
        return payload

    def submit_steering_request(
        self,
        workflow_id: str,
        *,
        request_id: str,
        request_text: str,
        work_item_id: str | None = None,
        task_id: str | None = None,
        linked_input_packet_ids: list[str] | None = None,
        session_id: str | None = None,
        base_snapshot_version: str | None = None,
    ) -> dict[str, str | None]:
        payload = {
            "workflow_id": workflow_id,
            "request_id": request_id,
            "request_text": request_text,
            "work_item_id": work_item_id,
        }
        self.steering_calls.append(payload)
        return payload


class OperatorFlowTests(unittest.TestCase):
    def test_submit_pending_operator_approvals_applies_default_decision_to_all_pending_items(self) -> None:
        api = FakeRunApi()
        approvals = {
            "stage_gates": [
                {"gate_id": "gate-1", "workflow_id": "wf-1", "status": "awaiting_approval"},
                {"gate_id": "gate-2", "workflow_id": "wf-1", "status": "awaiting_approval"},
            ]
        }
        run_spec = {
            "id": "bug-fix-approval",
            "operator_actions": [{"kind": "approval", "decision": "approve"}],
        }

        actions = submit_pending_operator_approvals(
            api,
            approvals,
            workflow_id="wf-1",
            run_spec=run_spec,
            consumed_action_indices=set(),
        )

        self.assertEqual(2, len(actions))
        self.assertEqual(["approve", "approve"], [call["action"] for call in api.approval_calls])

    def test_submit_pending_operator_approvals_rejects_unhandled_pending_approval(self) -> None:
        api = FakeRunApi()
        approvals = {"stage_gates": [{"gate_id": "gate-1", "workflow_id": "wf-1", "status": "awaiting_approval"}]}

        with self.assertRaisesRegex(RuntimeError, "unhandled approval"):
            submit_pending_operator_approvals(
                api,
                approvals,
                workflow_id="wf-1",
                run_spec={"id": "bug-fix-smoke", "operator_actions": []},
                consumed_action_indices=set(),
            )

    def test_submit_ready_steering_requests_targets_first_non_terminal_work_item_after_first_brief(self) -> None:
        api = FakeRunApi()
        briefs = [{"id": "brief-1"}]
        work_items = [
            {"id": "wi-1", "title": "Prep notes", "state": "completed"},
            {"id": "wi-2", "title": "Draft recommendation", "state": "in_progress"},
        ]
        run_spec = {
            "id": "research-analysis-steering",
            "steering_script": [
                {
                    "when": "after_first_brief",
                    "message": "Refocus the recommendation around operating cost and rollout risk.",
                }
            ],
        }

        actions = submit_ready_steering_requests(
            api,
            briefs,
            work_items,
            workflow_id="wf-1",
            run_spec=run_spec,
            consumed_indices=set(),
        )

        self.assertEqual(1, len(actions))
        self.assertEqual("wi-2", api.steering_calls[0]["work_item_id"])


if __name__ == "__main__":
    unittest.main()
