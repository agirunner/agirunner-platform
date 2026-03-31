#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


LIVE_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_SCRIPTS))
sys.path.insert(0, str(LIVE_LIB))

import validate_live_result  # noqa: E402
import workflow_scope_trace  # noqa: E402
from live_result_completeness_support import LiveResultCompletenessSupport  # noqa: E402


class LiveResultCompletenessReconciliationTests(LiveResultCompletenessSupport, unittest.TestCase):
    def test_reconcile_enhanced_live_console_flags_missing_expected_rows(self) -> None:
        result = workflow_scope_trace.reconcile_enhanced_live_console(
            execution_logs={
                "data": [
                    {
                        "id": "111",
                        "operation": "agent.think",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "think",
                            "approach": "Inspect the current task state before acting.",
                        },
                    }
                ]
            },
            execution_turn_items=[],
            effective_mode="enhanced",
            scope_kind="selected_task",
            work_item_id="wi-1",
            task_id="task-1",
        )

        self.assertFalse(result["passed"])
        self.assertIn("execution-log:111", "\n".join(result["failures"]))

    def test_reconcile_enhanced_live_console_accepts_phase_prefixed_and_humanized_rows(self) -> None:
        result = workflow_scope_trace.reconcile_enhanced_live_console(
            execution_logs={
                "data": [
                    {
                        "id": "111",
                        "operation": "agent.think",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "think",
                            "approach": "approach: Confirm the current work item state before dispatching.",
                        },
                    },
                    {
                        "id": "112",
                        "operation": "agent.act",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "act",
                            "tool": "create_task",
                            "input": {
                                "title": "Assess workflows-intake-01 triage readiness",
                                "role": "policy-assessor",
                            },
                        },
                    },
                ]
            },
            execution_turn_items=[
                {
                    "log_id": "111",
                    "item_id": "execution-log:111",
                    "headline": "[Think] Confirm the current work item state before dispatching.",
                    "summary": "Confirm the current work item state before dispatching.",
                    "task_id": "task-1",
                    "work_item_id": "wi-1",
                },
                {
                    "log_id": "112",
                    "item_id": "execution-log:112",
                    "headline": "[Act] Creating a task: Assess workflows-intake-01 triage readiness",
                    "summary": "Creating a task: Assess workflows-intake-01 triage readiness",
                    "task_id": "task-1",
                    "work_item_id": "wi-1",
                },
            ],
            effective_mode="enhanced",
            scope_kind="selected_task",
            work_item_id="wi-1",
            task_id="task-1",
        )

        self.assertTrue(result["passed"])
        self.assertEqual([], result["failures"])

    def test_reconcile_enhanced_live_console_accepts_literal_action_fallback_inside_act_line(self) -> None:
        result = workflow_scope_trace.reconcile_enhanced_live_console(
            execution_logs={
                "data": [
                    {
                        "id": "211",
                        "operation": "agent.act",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "act",
                            "tool": "shell_exec",
                            "input": {
                                "command": "pytest tests/unit",
                            },
                        },
                    }
                ]
            },
            execution_turn_items=[
                {
                    "log_id": "211",
                    "item_id": "execution-log:211",
                    "headline": '[Act] calling shell_exec(command="pytest tests/unit")',
                    "summary": 'calling shell_exec(command="pytest tests/unit")',
                    "task_id": "task-1",
                    "work_item_id": "wi-1",
                }
            ],
            effective_mode="enhanced",
            scope_kind="selected_task",
            work_item_id="wi-1",
            task_id="task-1",
        )

        self.assertTrue(result["passed"])
        self.assertEqual([], result["failures"])

    def test_reconcile_enhanced_live_console_flags_scope_mismatch_for_surfaced_row(self) -> None:
        result = workflow_scope_trace.reconcile_enhanced_live_console(
            execution_logs={
                "data": [
                    {
                        "id": "311",
                        "operation": "agent.plan",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "plan",
                            "plan_summary": "Check whether the current intake item is ready for closure.",
                        },
                    }
                ]
            },
            execution_turn_items=[
                {
                    "log_id": "311",
                    "item_id": "execution-log:311",
                    "headline": "[Plan] Check whether the current intake item is ready for closure.",
                    "summary": "Check whether the current intake item is ready for closure.",
                    "task_id": "task-2",
                    "work_item_id": "wi-1",
                }
            ],
            effective_mode="enhanced",
            scope_kind="selected_task",
            work_item_id="wi-1",
            task_id="task-1",
        )

        self.assertFalse(result["passed"])
        self.assertIn("task scope mismatch", "\n".join(result["failures"]))

    def test_reconcile_enhanced_live_console_flags_suppressed_read_only_actions(self) -> None:
        result = workflow_scope_trace.reconcile_enhanced_live_console(
            execution_logs={
                "data": [
                    {
                        "id": "222",
                        "operation": "agent.act",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "act",
                            "tool": "file_read",
                            "input": {"path": "task input"},
                        },
                    }
                ]
            },
            execution_turn_items=[
                {
                    "log_id": "222",
                    "item_id": "execution-log:222",
                    "headline": "calling file_read(path=\"task input\")",
                    "summary": "Working through the next step for Task.",
                    "task_id": "task-1",
                    "work_item_id": "wi-1",
                }
            ],
            effective_mode="enhanced",
            scope_kind="selected_task",
            work_item_id="wi-1",
            task_id="task-1",
        )

        self.assertFalse(result["passed"])
        self.assertIn("suppressed", "\n".join(result["failures"]))

    def test_reconcile_enhanced_live_console_flags_forbidden_wrapper_leakage(self) -> None:
        result = workflow_scope_trace.reconcile_enhanced_live_console(
            execution_logs={
                "data": [
                    {
                        "id": "333",
                        "operation": "agent.think",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "think",
                            "approach": "Confirm the current work item state before routing.",
                        },
                    }
                ]
            },
            execution_turn_items=[
                {
                    "log_id": "333",
                    "item_id": "execution-log:333",
                    "headline": "to=record_operator_update {\"request_id\":\"bad\"}",
                    "summary": "Working through the next step for Task.",
                    "task_id": "task-1",
                    "work_item_id": "wi-1",
                }
            ],
            effective_mode="enhanced",
            scope_kind="selected_task",
            work_item_id="wi-1",
            task_id="task-1",
        )

        self.assertFalse(result["passed"])
        self.assertIn("forbidden", "\n".join(result["failures"]))

    def test_reconcile_enhanced_live_console_ignores_surfaced_rows_beyond_stale_raw_capture_horizon(self) -> None:
        result = workflow_scope_trace.reconcile_enhanced_live_console(
            execution_logs={
                "data": [
                    {
                        "id": "111",
                        "operation": "agent.think",
                        "task_id": "task-1",
                        "work_item_id": "wi-1",
                        "payload": {
                            "phase": "think",
                            "approach": "Inspect the current work item state before routing.",
                        },
                    }
                ]
            },
            execution_turn_items=[
                {
                    "log_id": "111",
                    "item_id": "execution-log:111",
                    "headline": "[Think] Inspect the current work item state before routing.",
                    "summary": "Inspect the current work item state before routing.",
                    "task_id": "task-1",
                    "work_item_id": "wi-1",
                },
                {
                    "log_id": "222",
                    "item_id": "execution-log:222",
                    "headline": "[Observe] The latest policy assessment is still pending.",
                    "summary": "The latest policy assessment is still pending.",
                    "task_id": "task-1",
                    "work_item_id": "wi-1",
                },
            ],
            effective_mode="enhanced",
            scope_kind="selected_task",
            work_item_id="wi-1",
            task_id="task-1",
        )

        self.assertTrue(result["passed"])
        self.assertEqual([], result["failures"])

    def test_workflow_scope_db_summary_rolls_up_work_item_deliverables(self) -> None:
        summary = workflow_scope_trace.summarize_db_scope(
            {
                "deliverables": [
                    {
                        "descriptor_id": "deliverable-1",
                        "descriptor_kind": "deliverable_packet",
                        "delivery_stage": "final",
                        "state": "final",
                        "work_item_id": "wi-1",
                    }
                ],
                "operator_briefs": [],
                "completed_handoffs": [],
            },
            scope_kind="workflow",
            work_item_id=None,
            task_id=None,
        )

        self.assertEqual(["deliverable-1"], summary["all_descriptor_ids"])
        self.assertEqual(["deliverable-1"], summary["final_descriptor_ids"])
        self.assertEqual({"deliverable_packet": 1}, summary["deliverable_descriptor_kind_counts"])


if __name__ == "__main__":
    unittest.main()
