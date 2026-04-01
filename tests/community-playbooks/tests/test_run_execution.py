#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from run_execution import execute_run, summarize_workspace_packet


class FakeRunApi:
    def __init__(self) -> None:
        self.workflow_reads = 0
        self.created_workspace_payloads: list[dict[str, object]] = []
        self.created_workflow_payloads: list[dict[str, object]] = []
        self.approval_calls: list[dict[str, str]] = []

    def create_workspace(self, payload: dict[str, object]) -> dict[str, str]:
        self.created_workspace_payloads.append(payload)
        return {"id": "ws-1", "slug": str(payload["slug"])}

    def create_workflow(self, payload: dict[str, object]) -> dict[str, str]:
        self.created_workflow_payloads.append(payload)
        return {"id": "wf-1", "state": "planned", "workspace_id": "ws-1"}

    def get_workflow(self, workflow_id: str) -> dict[str, str]:
        self.workflow_reads += 1
        if self.workflow_reads == 1:
            return {"id": workflow_id, "state": "in_progress"}
        return {"id": workflow_id, "state": "completed"}

    def list_work_items(self, workflow_id: str) -> list[dict[str, str]]:
        return [{"id": "wi-1", "title": "Draft recommendation", "state": "in_progress"}]

    def list_operator_briefs(
        self,
        workflow_id: str,
        *,
        work_item_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, str]]:
        return [{"id": "brief-1", "work_item_id": "wi-1"}]

    def list_approvals(self) -> dict[str, list[dict[str, str]]]:
        if self.workflow_reads == 0:
            return {"stage_gates": []}
        return {
            "stage_gates": [
                {
                    "gate_id": "gate-1",
                    "workflow_id": "wf-1",
                    "status": "awaiting_approval",
                }
            ]
        }

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
        return {
            "workflow_id": workflow_id,
            "request_id": request_id,
            "request_text": request_text,
            "work_item_id": work_item_id,
        }

    def get_workspace_packet(
        self,
        workflow_id: str,
        *,
        work_item_id: str | None = None,
        live_console_limit: int = 100,
        deliverables_limit: int = 100,
        briefs_limit: int = 100,
        history_limit: int = 100,
    ) -> dict[str, object]:
        return {
            "live_console": {"total_count": 3},
            "deliverables": {
                "final_deliverables": [{"descriptor_kind": "brief_packet"}],
                "in_progress_deliverables": [],
            },
        }


class RunExecutionTests(unittest.TestCase):
    def test_summarize_workspace_packet_counts_deliverables_and_console(self) -> None:
        summary = summarize_workspace_packet(
            {
                "live_console": {"total_count": 4},
                "deliverables": {
                    "final_deliverables": [{"descriptor_kind": "artifact"}, {"descriptor_kind": "repository"}],
                    "in_progress_deliverables": [{"descriptor_kind": "inline_summary"}],
                },
            }
        )

        self.assertEqual(4, summary["live_console_total"])
        self.assertEqual(2, summary["final_deliverable_count"])
        self.assertEqual(1, summary["in_progress_deliverable_count"])
        self.assertEqual(
            {"artifact": 1, "repository": 1, "inline_summary": 1},
            summary["descriptor_kind_counts"],
        )

    def test_execute_run_creates_workspace_and_workflow_and_writes_result_file(self) -> None:
        api = FakeRunApi()
        playbook = {
            "id": "pb-1",
            "slug": "bug-fix",
            "name": "Bug Fix",
            "definition": {
                "parameters": [
                    {"slug": "issue_summary", "title": "Issue summary", "required": True},
                ]
            },
        }
        run_spec = {
            "id": "bug-fix-approval",
            "batch": "controls",
            "playbook_slug": "bug-fix",
            "variant": "approval",
            "workspace_profile_record": {"storage_type": "workspace_artifacts"},
            "launch_inputs": {"issue_summary": "Exports stall after sixty seconds."},
            "uploads": [],
            "operator_actions": [{"kind": "approval", "decision": "approve"}],
            "steering_script": [],
            "expected_outcome": {"kind": "approved_engineering_handoff"},
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_run(
                api,
                playbook,
                run_spec,
                results_dir=Path(tmpdir),
                timeout_seconds=2,
                poll_interval_seconds=0,
            )

            self.assertTrue(result["passed"])
            self.assertEqual("completed", result["workflow"]["state"])
            self.assertEqual(1, len(api.created_workspace_payloads))
            self.assertEqual(1, len(api.created_workflow_payloads))
            self.assertEqual(1, len(api.approval_calls))
            self.assertTrue(Path(result["result_file"]).is_file())

    def test_execute_run_can_pause_for_manual_approval_review(self) -> None:
        api = FakeRunApi()
        playbook = {
            "id": "pb-1",
            "slug": "bug-fix",
            "name": "Bug Fix",
            "definition": {
                "parameters": [
                    {"slug": "issue_summary", "title": "Issue summary", "required": True},
                ]
            },
        }
        run_spec = {
            "id": "bug-fix-approval",
            "batch": "controls",
            "playbook_slug": "bug-fix",
            "variant": "approval",
            "workspace_profile_record": {"storage_type": "workspace_artifacts"},
            "launch_inputs": {"issue_summary": "Exports stall after sixty seconds."},
            "uploads": [],
            "operator_actions": [{"kind": "approval", "decision": "approve"}],
            "steering_script": [],
            "expected_outcome": {"kind": "approved_engineering_handoff"},
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_run(
                api,
                playbook,
                run_spec,
                results_dir=Path(tmpdir),
                timeout_seconds=2,
                poll_interval_seconds=0,
                manual_operator_actions=True,
            )

            self.assertTrue(result["passed"])
            self.assertFalse(result["timed_out"])
            self.assertEqual("in_progress", result["workflow"]["state"])
            self.assertEqual(0, len(api.approval_calls))
            self.assertTrue(result["operator_actions"]["manual_mode"])
            self.assertEqual(1, len(result["operator_actions"]["manual_pending"]["pending_approvals"]))


if __name__ == "__main__":
    unittest.main()
