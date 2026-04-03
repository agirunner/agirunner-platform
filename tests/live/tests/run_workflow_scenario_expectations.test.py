#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import run_workflow_scenario  # noqa: E402
import run_workflow_scenario_chunk10  # noqa: E402


class EvaluateExpectationsTests(unittest.TestCase):
    def test_evaluate_expectations_returns_result_for_minimal_snapshot(self) -> None:
        result = run_workflow_scenario.evaluate_expectations(
            {},
            workflow={"id": "workflow-123", "state": "active", "tasks": []},
            board={"ok": True, "data": {"columns": [], "work_items": []}},
            work_items={"ok": True, "data": {"data": []}},
            workspace={"id": "workspace-123"},
            artifacts={"ok": True, "data": {"data": []}},
            approval_actions=[],
        )

        self.assertIsInstance(result, dict)
        self.assertIn("passed", result)
        self.assertIn("failures", result)
        self.assertIn("checks", result)

    def test_evaluate_progress_expectations_collects_full_evidence_without_name_errors(self) -> None:
        class FakeClient:
            def best_effort_request(self, _method: str, _path: str, **_kwargs: object) -> dict[str, object]:
                return {
                    "ok": True,
                    "data": {
                        "data": [],
                        "meta": {
                            "has_more": False,
                            "next_after": None,
                        },
                    },
                }

        with (
            patch.object(run_workflow_scenario_chunk10, "fetch_workflow_tasks", return_value=[]),
            patch.object(
                run_workflow_scenario_chunk10,
                "attach_workflow_tasks",
                side_effect=lambda workflow, _tasks: workflow,
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "evaluate_expectations",
                side_effect=[
                    {"passed": False, "failures": ["needs more evidence"]},
                    {"passed": True, "failures": [], "checks": [], "advisories": [], "approval_actions": []},
                ],
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "collect_execution_logs",
                return_value={"data": []},
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "collect_live_container_snapshot",
                return_value={"ok": True, "data": []},
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "collect_db_state_snapshot",
                return_value={"ok": True},
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "summarize_execution_environment_usage",
                return_value={},
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "summarize_log_anomalies",
                return_value=[],
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "inspect_runtime_cleanup",
                return_value={"all_clean": True},
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "build_capability_proof",
                return_value={},
            ),
            patch.object(
                run_workflow_scenario_chunk10,
                "summarize_efficiency",
                return_value={},
            ),
        ):
            result = run_workflow_scenario.evaluate_progress_expectations(
                client=FakeClient(),
                workflow_id="workflow-123",
                expectations={"outcome_envelope": {"allowed_states": ["active"]}},
                workflow={"id": "workflow-123", "state": "active", "tasks": []},
                board={"ok": True, "data": {"columns": [], "work_items": []}},
                work_items={"ok": True, "data": {"data": []}},
                stage_gates={"ok": True, "data": []},
                workspace={"id": "workspace-123"},
                artifacts={"ok": True, "data": {"data": []}},
                approval_actions=[],
                fleet={"ok": True, "data": {}},
                playbook_id="playbook-123",
                fleet_peaks={},
                verification_mode=run_workflow_scenario.OUTCOME_DRIVEN_VERIFICATION_MODE,
                trace=None,
            )

        self.assertTrue(result["passed"])


if __name__ == "__main__":
    unittest.main()
