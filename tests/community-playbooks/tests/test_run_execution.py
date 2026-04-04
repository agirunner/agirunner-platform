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
from test_run_execution_support import FakeRunApi


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

    def test_execute_run_applies_profile_default_execution_environment_before_launch(self) -> None:
        api = FakeRunApi()
        playbook = {
            "id": "pb-1",
            "slug": "bug-fix",
            "name": "Bug Fix",
            "definition": {"parameters": []},
        }
        run_spec = {
            "id": "bug-fix-approval",
            "batch": "controls",
            "playbook_slug": "bug-fix",
            "variant": "approval",
            "workspace_profile_record": {
                "storage_type": "workspace_artifacts",
                "default_execution_environment_alias": "node-base",
            },
            "launch_inputs": {},
            "uploads": [],
            "operator_actions": [{"kind": "approval", "decision": "approve"}],
            "steering_script": [],
            "expected_outcome": {"kind": "approved_engineering_handoff"},
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            execute_run(
                api,
                playbook,
                run_spec,
                results_dir=Path(tmpdir),
                timeout_seconds=2,
                poll_interval_seconds=0,
            )

        self.assertEqual(["env-node"], api.default_execution_environment_calls)
        self.assertEqual(
            ["set_default:env-node", "create_workspace", "create_workflow"],
            api.call_order[:3],
        )

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

    def test_execute_run_fails_fast_on_provider_quota_errors(self) -> None:
        class ProviderBlockedApi(FakeRunApi):
            def get_workflow(self, workflow_id: str) -> dict[str, str]:
                self.workflow_reads += 1
                return {"id": workflow_id, "state": "in_progress"}

            def list_work_items(self, workflow_id: str) -> list[dict[str, str]]:
                return []

            def list_operator_briefs(
                self,
                workflow_id: str,
                *,
                work_item_id: str | None = None,
                limit: int = 50,
            ) -> list[dict[str, str]]:
                return []

            def list_approvals(self) -> dict[str, list[dict[str, str]]]:
                return {"stage_gates": []}

            def list_logs(
                self,
                *,
                workflow_id: str,
                status: str = "failed",
                per_page: int = 20,
            ) -> list[dict[str, object]]:
                return [
                    {
                        "error": {
                            "message": (
                                "anthropic (invalid_request): You have reached your specified API usage limits."
                            )
                        }
                    }
                ]

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
                    "live_console": {"total_count": 0},
                    "deliverables": {
                        "final_deliverables": [],
                        "in_progress_deliverables": [],
                    },
                }

        api = ProviderBlockedApi()
        playbook = {
            "id": "pb-1",
            "slug": "bug-fix",
            "name": "Bug Fix",
            "definition": {"parameters": []},
        }
        run_spec = {
            "id": "bug-fix-approval",
            "batch": "controls",
            "playbook_slug": "bug-fix",
            "variant": "approval",
            "workspace_profile_record": {"storage_type": "workspace_artifacts"},
            "launch_inputs": {},
            "uploads": [],
            "operator_actions": [],
            "steering_script": [],
            "expected_outcome": {"kind": "provider-blocked"},
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_run(
                api,
                playbook,
                run_spec,
                results_dir=Path(tmpdir),
                timeout_seconds=30,
                poll_interval_seconds=0,
            )

            self.assertFalse(result["passed"])
            self.assertFalse(result["timed_out"])
            self.assertIn("provider blocked live run", result["failures"][0])
            self.assertIn("usage limits", str(result["provider_blocker_message"]).lower())

if __name__ == "__main__":
    unittest.main()
