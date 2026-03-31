#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

ARTIFACT_ROOT = Path("tmp") / "agirunner-artifacts"

import run_workflow_scenario  # noqa: E402


class RunWorkflowResultBundleOutputTests(unittest.TestCase):
    def test_build_run_result_payload_backfills_settled_outputs_when_workspace_artifacts_are_empty(
        self,
    ) -> None:
        workflow = {
            "id": "workflow-123",
            "state": "completed",
            "tasks": [
                {
                    "id": "task-1",
                    "role": "developer",
                    "title": "Implement change",
                    "work_item_id": "wi-1",
                    "state": "completed",
                    "is_orchestrator_task": False,
                    "completed_at": "2026-03-29T22:00:00.000Z",
                    "output": {
                        "artifacts": [
                            {"path": str(ARTIFACT_ROOT / "task-1" / "result_output.json"), "size": 77},
                            {"path": str(ARTIFACT_ROOT / "task-1" / "summary.json"), "size": 155},
                        ]
                    },
                },
                {
                    "id": "task-2",
                    "role": "qa",
                    "title": "Assess change",
                    "work_item_id": "wi-2",
                    "state": "completed",
                    "is_orchestrator_task": False,
                    "completed_at": "2026-03-29T22:05:00.000Z",
                    "output": {
                        "artifacts": [
                            {"path": str(ARTIFACT_ROOT / "task-2" / "result_output.json"), "size": 88},
                        ]
                    },
                },
            ],
        }
        work_items = {
            "ok": True,
            "data": {
                "data": [
                    {"id": "wi-1", "title": "Implement feature", "stage_name": "implementation"},
                    {"id": "wi-2", "title": "Assess feature", "stage_name": "review"},
                ]
            },
        }
        artifacts = {
            "ok": True,
            "data": {
                "data": [],
                "meta": {
                    "page": 1,
                    "per_page": 20,
                    "total": 0,
                    "total_pages": 1,
                    "has_more": False,
                    "summary": {"total_artifacts": 0},
                    "filters": {},
                },
            },
        }
        evidence = {
            "db_state": {
                "ok": True,
                "deliverables": [
                    {
                        "descriptor_id": "descriptor-1",
                        "work_item_id": "wi-1",
                        "descriptor_kind": "deliverable_packet",
                        "delivery_stage": "final",
                        "state": "final",
                    },
                    {
                        "descriptor_id": "descriptor-2",
                        "work_item_id": "wi-2",
                        "descriptor_kind": "deliverable_packet",
                        "delivery_stage": "final",
                        "state": "final",
                    },
                ],
                "completed_handoffs": [
                    {
                        "id": "handoff-1",
                        "work_item_id": "wi-1",
                        "task_id": "task-1",
                        "role": "developer",
                        "created_at": "2026-03-29T22:00:01.000Z",
                    },
                    {
                        "id": "handoff-2",
                        "work_item_id": "wi-2",
                        "task_id": "task-2",
                        "role": "qa",
                        "created_at": "2026-03-29T22:05:01.000Z",
                    },
                ],
            }
        }

        payload = run_workflow_scenario.build_run_result_payload(
            workflow_id="workflow-123",
            final_state="completed",
            timed_out=False,
            poll_iterations=7,
            scenario_name="demo",
            approval_mode="auto",
            provider_auth_mode="shared_oauth",
            verification_mode="outcome_driven",
            workflow=workflow,
            board={"ok": True, "data": {}},
            work_items=work_items,
            stage_gates={"ok": True, "data": []},
            events={"ok": True, "data": []},
            approvals={"ok": True, "data": []},
            approval_actions=[],
            workflow_actions=[],
            workspace={"id": "workspace-1"},
            artifacts=artifacts,
            fleet={"ok": True, "data": {}},
            fleet_peaks={},
            verification={"passed": True, "failures": []},
            execution_logs={"data": []},
            efficiency={},
            evidence=evidence,
            execution_environment={},
            capability_proof={},
        )

        self.assertEqual(3, len(payload["produced_artifacts"]))
        self.assertEqual(3, len(payload["artifacts"]["data"]["data"]))
        self.assertEqual(3, payload["artifacts"]["data"]["meta"]["total"])
        self.assertEqual(2, len(payload["final_outputs"]))
        self.assertEqual("descriptor-1", payload["final_outputs"][0]["descriptor_id"])
        self.assertEqual("wi-1", payload["final_outputs"][0]["work_item_id"])
        self.assertEqual("task-1", payload["final_outputs"][0]["task_id"])
        self.assertEqual(2, payload["final_outputs"][0]["artifact_count"])


if __name__ == "__main__":
    unittest.main()
