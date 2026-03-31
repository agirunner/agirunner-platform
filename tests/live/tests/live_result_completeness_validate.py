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


class LiveResultCompletenessValidateTests(LiveResultCompletenessSupport, unittest.TestCase):
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

    def test_validate_result_file_rejects_missing_settled_output_bundle_when_outputs_exist(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence = self.build_complete_evidence(evidence_dir)
            evidence["db_state"] = {
                "ok": True,
                "deliverables": [
                    {
                        "descriptor_id": "descriptor-1",
                        "work_item_id": "wi-1",
                        "descriptor_kind": "deliverable_packet",
                        "delivery_stage": "final",
                        "state": "final",
                    }
                ],
                "completed_handoffs": [
                    {
                        "id": "handoff-1",
                        "work_item_id": "wi-1",
                        "task_id": "task-1",
                        "role": "developer",
                    }
                ],
            }

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
                        "outcome_metrics": {
                            "status": "passed",
                            "success": {"output_artifact_count": 2},
                        },
                        "artifacts": {"ok": True, "data": {"data": []}},
                        "produced_artifacts": [],
                        "final_outputs": None,
                        "evidence": evidence,
                    }
                ),
                encoding="utf-8",
            )

            result = validate_live_result.validate_result_file(result_path)

            self.assertFalse(result.is_valid)
            self.assertIn(
                "produced_artifacts must be a non-empty list when output_artifact_count is greater than zero",
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
