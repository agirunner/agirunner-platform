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


class LiveResultCompletenessTests(unittest.TestCase):
    def build_complete_evidence(
        self,
        evidence_dir: Path,
        *,
        workspace_scope_trace: dict[str, object] | None = None,
    ) -> dict[str, object]:
        evidence: dict[str, object] = {}
        artifacts: dict[str, str] = {}
        for key in validate_live_result.REQUIRED_SETTLED_EVIDENCE_KEYS:
            if key == "workspace_scope_trace":
                payload = workspace_scope_trace or self.build_workspace_scope_trace()
            else:
                payload = {"ok": True, "key": key}
            artifact_path = evidence_dir / f"{key}.json"
            artifact_path.write_text(json.dumps(payload), encoding="utf-8")
            evidence[key] = payload
            artifacts[key] = str(artifact_path)
        evidence["artifacts"] = artifacts
        return evidence

    def build_workspace_scope_trace(self) -> dict[str, object]:
        return {
            "ok": True,
            "failures": [],
            "selected_work_item_id": "wi-1",
            "workflow_scope": self.build_scope_entry(
                scope_kind="workflow",
                work_item_id=None,
                task_id=None,
            ),
            "selected_work_item_scope": self.build_scope_entry(
                scope_kind="selected_work_item",
                work_item_id="wi-1",
                task_id=None,
            ),
        }

    def build_scope_entry(
        self,
        *,
        scope_kind: str,
        work_item_id: str | None,
        task_id: str | None,
    ) -> dict[str, object]:
        live_console_ids = {
            "brief_ids": ["brief-1"],
            "execution_turn_ids": ["111"],
            "execution_turn_items": [
                {
                    "log_id": "111",
                    "item_id": "execution-log:111",
                    "headline": "[Think] Inspect the seeded workflow state before routing work.",
                    "summary": "Inspect the seeded workflow state before routing work.",
                    "task_id": task_id,
                    "work_item_id": work_item_id,
                }
            ],
        }
        deliverable_ids = {
            "all_descriptor_ids": ["descriptor-1", "brief-1", "handoff-1"],
            "final_descriptor_ids": ["descriptor-1"],
            "in_progress_descriptor_ids": [],
            "brief_packet_ids": ["brief-1"],
            "handoff_packet_ids": ["handoff-1"],
            "working_handoff_brief_ids": ["brief-1"],
        }
        return {
            "scope_kind": scope_kind,
            "selection": {
                "work_item_id": work_item_id,
                "task_id": task_id,
            },
            "workspace_api": {
                "selected_scope": {
                    "scope_kind": scope_kind,
                    "work_item_id": work_item_id,
                    "task_id": task_id,
                },
                "live_console": {
                    "item_kind_counts": {
                        "milestone_brief": 1,
                        "execution_turn": 1,
                    },
                    "tracked_item_kind_counts": {
                        "milestone_brief": 1,
                    },
                    **live_console_ids,
                },
                "deliverables": {
                    "descriptor_kind_counts": {
                        "report": 1,
                        "brief_packet": 1,
                        "handoff_packet": 1,
                    },
                    **deliverable_ids,
                },
            },
            "db": {
                **live_console_ids,
                **deliverable_ids,
                "all_descriptor_ids": ["descriptor-1", "brief-1", "handoff-1"],
                "record_item_kind_counts": {
                    "milestone_brief": 1,
                },
                "deliverable_descriptor_kind_counts": {
                    "report": 1,
                    "brief_packet": 1,
                    "handoff_packet": 1,
                },
            },
            "enhanced_live_console": {
                "applicable": True,
                "effective_mode": "enhanced",
                "expected_rows": [
                    {
                        "log_id": "111",
                        "operation": "agent.think",
                        "phase": "think",
                        "phase_label": "Think",
                        "surface_expected": True,
                        "surface_kind": "execution_turn",
                        "expected_headline": "[Think] Inspect the seeded workflow state before routing work.",
                        "expected_summary": "Inspect the seeded workflow state before routing work.",
                        "task_id": task_id,
                        "work_item_id": work_item_id,
                    },
                    {
                        "log_id": "112",
                        "operation": "agent.act",
                        "phase": "act",
                        "phase_label": "Act",
                        "surface_expected": False,
                        "surface_kind": "execution_turn",
                        "expected_headline": None,
                        "expected_summary": None,
                        "suppression_reason": "low_value_read_only_tool",
                        "task_id": task_id,
                        "work_item_id": work_item_id,
                    },
                ],
                "actual_rows": [
                    live_console_ids["execution_turn_items"][0]
                ],
                "passed": True,
                "failures": [],
            },
            "reconciliation": {
                "passed": True,
                "failures": [],
            },
        }

    def test_validate_result_file_accepts_complete_settled_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence = self.build_complete_evidence(evidence_dir)

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertTrue(result.is_valid)
            self.assertEqual([], result.failures)

    def test_validate_result_file_rejects_missing_required_evidence_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence: dict[str, object] = {}
            artifacts: dict[str, str] = {}
            missing_key = "runtime_cleanup"
            for key in validate_live_result.REQUIRED_SETTLED_EVIDENCE_KEYS:
                payload = (
                    self.build_workspace_scope_trace()
                    if key == "workspace_scope_trace"
                    else {"ok": True, "key": key}
                )
                evidence[key] = payload
                artifact_path = evidence_dir / f"{key}.json"
                artifact_path.write_text(json.dumps(payload), encoding="utf-8")
                artifacts[key] = str(artifact_path)
            (evidence_dir / f"{missing_key}.json").unlink()
            evidence["artifacts"] = artifacts

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertFalse(result.is_valid)
            self.assertIn(
                "missing evidence artifact file for runtime_cleanup",
                "\n".join(result.failures),
            )

    def test_validate_result_file_rejects_missing_workspace_scope_trace_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence = self.build_complete_evidence(evidence_dir)
            evidence.pop("workspace_scope_trace", None)

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertFalse(result.is_valid)
            self.assertIn(
                "missing required evidence payload for workspace_scope_trace",
                "\n".join(result.failures),
            )

    def test_validate_result_file_rejects_empty_evidence_artifact_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence = self.build_complete_evidence(evidence_dir)
            artifact_path = evidence_dir / "workspace_scope_trace.json"
            artifact_path.write_text("", encoding="utf-8")

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertFalse(result.is_valid)
            self.assertIn(
                "evidence artifact file for workspace_scope_trace is empty",
                "\n".join(result.failures),
            )

    def test_validate_result_file_rejects_failed_workspace_scope_reconciliation(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            workspace_scope_trace = self.build_workspace_scope_trace()
            selected_work_item_scope = workspace_scope_trace["selected_work_item_scope"]
            assert isinstance(selected_work_item_scope, dict)
            selected_work_item_scope["reconciliation"] = {
                "passed": False,
                "failures": ["selected_work_item_scope live console brief id mismatch"],
            }
            evidence = self.build_complete_evidence(
                evidence_dir,
                workspace_scope_trace=workspace_scope_trace,
            )

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertFalse(result.is_valid)
            self.assertIn(
                "selected_work_item_scope live console brief id mismatch",
                "\n".join(result.failures),
            )

    def test_validate_result_file_accepts_workspace_scope_trace_without_selected_task_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence = self.build_complete_evidence(
                evidence_dir,
                workspace_scope_trace=self.build_workspace_scope_trace(),
            )

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertTrue(result.is_valid)
            self.assertEqual([], result.failures)

    def test_validate_result_file_rejects_failed_enhanced_live_console_reconciliation(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            workspace_scope_trace = self.build_workspace_scope_trace()
            selected_work_item_scope = workspace_scope_trace["selected_work_item_scope"]
            assert isinstance(selected_work_item_scope, dict)
            selected_work_item_scope["enhanced_live_console"] = {
                "applicable": True,
                "effective_mode": "enhanced",
                "expected_rows": [],
                "actual_rows": [],
                "passed": False,
                "failures": ["selected_work_item_scope missing expected enhanced turn line execution-log:111"],
            }
            evidence = self.build_complete_evidence(
                evidence_dir,
                workspace_scope_trace=workspace_scope_trace,
            )

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertFalse(result.is_valid)
            self.assertIn(
                "selected_work_item_scope missing expected enhanced turn line execution-log:111",
                "\n".join(result.failures),
            )

    def test_validate_result_file_requires_execution_turn_ids_in_workspace_scope_trace(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            workspace_scope_trace = self.build_workspace_scope_trace()
            selected_work_item_scope = workspace_scope_trace["selected_work_item_scope"]
            assert isinstance(selected_work_item_scope, dict)
            workspace_api = selected_work_item_scope["workspace_api"]
            assert isinstance(workspace_api, dict)
            live_console = workspace_api["live_console"]
            assert isinstance(live_console, dict)
            live_console.pop("execution_turn_ids", None)
            evidence = self.build_complete_evidence(
                evidence_dir,
                workspace_scope_trace=workspace_scope_trace,
            )

            result_path = scenario_dir / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "runner_exit_code": 0,
                        "workflow_state": "completed",
                        "state": "completed",
                        "verification_passed": True,
                        "verification": {"passed": True, "failures": []},
                        "harness_failure": False,
                        "outcome_metrics": {"status": "passed"},
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertFalse(result.is_valid)
            self.assertIn(
                "selected_work_item_scope.workspace_api.live_console.execution_turn_ids must be a list",
                "\n".join(result.failures),
            )

    def test_validate_result_file_accepts_explicit_harness_failure_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            result_path = Path(tmpdir) / "workflow-run.json"
            result_path.write_text(
                json.dumps(
                    {
                        "scenario_name": "demo",
                        "harness_failure": True,
                        "verification": {
                            "passed": False,
                            "failures": ["Harness failed before emitting a finalized workflow result."],
                        },
                        "harness": {
                            "phase": "runner",
                            "exit_code": 1,
                            "result_file": str(result_path),
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertTrue(result.is_valid)
            self.assertEqual([], result.failures)

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
