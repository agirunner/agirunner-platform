#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import workflows_ui_evidence  # noqa: E402


class WorkflowsUiEvidenceTests(unittest.TestCase):
    def test_summarize_run_payload_requires_runner_exit_code_outputs_db_state_and_cleanup(self) -> None:
        summary = workflows_ui_evidence.summarize_run_payload(
            {
                "runner_exit_code": 0,
                "verification": {"passed": True},
                "outcome_metrics": {
                    "success": {
                        "output_artifact_count": 2,
                        "terminal_work_item_count": 3,
                    },
                    "hygiene": {"runtime_cleanup_passed": True},
                },
                "evidence": {
                    "db_state": {"ok": True},
                    "log_anomalies": {"rows": []},
                    "runtime_cleanup": {"all_clean": True},
                },
            }
        )

        self.assertTrue(summary["runner_exit_code_ok"])
        self.assertTrue(summary["verification_passed"])
        self.assertTrue(summary["final_output_present"])
        self.assertTrue(summary["db_state_present"])
        self.assertTrue(summary["runtime_cleanup_passed"])
        self.assertTrue(summary["fatal_log_free"])

    def test_summarize_run_payload_uses_deliverables_packet_to_check_provenance(self) -> None:
        summary = workflows_ui_evidence.summarize_run_payload(
            {
                "runner_exit_code": 0,
                "verification": {"passed": True},
                "outcome_metrics": {"success": {"output_artifact_count": 0}},
                "evidence": {
                    "db_state": {"ok": True},
                    "log_anomalies": {"rows": []},
                    "runtime_cleanup": {"all_clean": True},
                },
            },
            deliverables_packet={
                "final_deliverables": [{"descriptor_id": "final-1"}],
                "inputs_and_provenance": {
                    "launch_packet": {"summary": "Launch packet"},
                    "supplemental_packets": [{"id": "supp-1"}],
                    "intervention_attachments": [{"id": "attachment-1"}],
                    "redrive_packet": {"summary": "Redrive packet"},
                },
            },
        )

        self.assertTrue(summary["final_output_present"])
        self.assertEqual(1, summary["deliverables"]["final_count"])
        self.assertEqual("Launch packet", summary["deliverables"]["launch_packet_summary"])
        self.assertEqual(1, summary["deliverables"]["supplemental_packet_count"])
        self.assertEqual(1, summary["deliverables"]["intervention_attachment_count"])
        self.assertEqual("Redrive packet", summary["deliverables"]["redrive_packet_summary"])

    def test_summarize_run_payload_flags_fatal_log_rows(self) -> None:
        summary = workflows_ui_evidence.summarize_run_payload(
            {
                "runner_exit_code": 0,
                "verification": {"passed": True},
                "outcome_metrics": {"success": {"output_artifact_count": 1}},
                "evidence": {
                    "db_state": {"ok": True},
                    "log_anomalies": {"rows": [{"level": "fatal", "message": "boom"}]},
                    "runtime_cleanup": {"all_clean": True},
                },
            }
        )

        self.assertFalse(summary["fatal_log_free"])
        self.assertEqual(1, summary["fatal_log_count"])


if __name__ == "__main__":
    unittest.main()
