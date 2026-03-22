#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import run_workflow_scenario  # noqa: E402


class FakeProgressClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, tuple[int, ...], str | None]] = []

    def best_effort_request(
        self,
        method: str,
        path: str,
        *,
        payload=None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ):
        return self.request(method, path, payload=payload, expected=expected, label=label)

    def request(
        self,
        method: str,
        path: str,
        *,
        payload=None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ):
        self.calls.append((method, path, expected, label))
        if label == "workflows.events":
            return {"data": {"data": []}}
        if label == "logs.list":
            return {"data": [], "pagination": {"has_more": False, "next_cursor": None}}
        raise AssertionError(f"unexpected request: {method} {path} ({label})")


class RunWorkflowProgressTests(unittest.TestCase):
    def test_evaluate_progress_expectations_collects_full_evidence_for_continuity_checks(self) -> None:
        client = FakeProgressClient()
        expectations = {
            "state": "pending",
            "work_items": {"all_terminal": True, "min_count": 2},
            "continuity_rework_sequences": [
                {
                    "stage_name": "intake-triage",
                    "required_role": "intake-analyst",
                    "minimum_rework_count": 1,
                    "assessment_stage_name": "intake-triage",
                    "assessment_task_min_count": 2,
                }
            ],
        }
        workflow = {
            "id": "wf-1",
            "state": "pending",
            "lifecycle": "ongoing",
            "tasks": [
                {"id": "task-1", "role": "intake-analyst", "is_orchestrator_task": False, "rework_count": 1},
                {"id": "task-2", "role": "policy-assessor", "is_orchestrator_task": False},
                {"id": "task-3", "role": "policy-assessor", "is_orchestrator_task": False},
            ],
        }
        work_items = {
            "data": {
                "data": [
                    {"id": "wi-1", "column_id": "done", "rework_count": 1, "stage_name": "intake-triage"},
                    {"id": "wi-2", "column_id": "done", "rework_count": 0, "stage_name": "intake-triage"},
                ]
            }
        }

        original_evaluate = run_workflow_scenario.evaluate_expectations
        original_summarize = run_workflow_scenario.summarize_efficiency

        def fake_evaluate(expectations, **kwargs):
            if kwargs.get("execution_logs") is None:
                return {"passed": False, "failures": ["needs logs"], "checks": [], "approval_actions": []}
            return {"passed": True, "failures": [], "checks": [], "approval_actions": []}

        try:
            run_workflow_scenario.evaluate_expectations = fake_evaluate
            run_workflow_scenario.summarize_efficiency = lambda **kwargs: {"workflow_duration_seconds": 1}
            verification = run_workflow_scenario.evaluate_progress_expectations(
                client,
                workflow_id="wf-1",
                expectations=expectations,
                workflow=workflow,
                board={"ok": True},
                work_items=work_items,
                workspace={"id": "workspace-1"},
                artifacts={"ok": True},
                approval_actions=[],
                fleet={"ok": True},
                playbook_id="playbook-1",
                fleet_peaks={"peak_running": 1},
            )
        finally:
            run_workflow_scenario.evaluate_expectations = original_evaluate
            run_workflow_scenario.summarize_efficiency = original_summarize

        self.assertTrue(verification["passed"])
        self.assertEqual(
            [
                ("GET", "/api/v1/workflows/wf-1/events?limit=100", (200,), "workflows.events"),
                ("GET", "/api/v1/logs?workflow_id=wf-1&per_page=250&detail=full&order=asc", (200,), "logs.list"),
            ],
            client.calls,
        )


if __name__ == "__main__":
    unittest.main()
