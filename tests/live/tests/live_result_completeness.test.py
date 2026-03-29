#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


LIVE_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(LIVE_SCRIPTS))

import validate_live_result  # noqa: E402


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
            "selected_task_id": "task-1",
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
            "selected_task_scope": self.build_scope_entry(
                scope_kind="selected_task",
                work_item_id="wi-1",
                task_id="task-1",
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
            "update_ids": ["update-1"],
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
                        "operator_update": 1,
                    },
                    "tracked_item_kind_counts": {
                        "milestone_brief": 1,
                        "operator_update": 1,
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
                "update_ids": ["update-1"],
                "update_item_kind_counts": {
                    "milestone_brief": 1,
                    "operator_update": 1,
                },
                "deliverable_descriptor_kind_counts": {
                    "report": 1,
                    "brief_packet": 1,
                    "handoff_packet": 1,
                },
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
            selected_task_scope = workspace_scope_trace["selected_task_scope"]
            assert isinstance(selected_task_scope, dict)
            selected_task_scope["reconciliation"] = {
                "passed": False,
                "failures": ["selected_task_scope live console brief id mismatch"],
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
                "selected_task_scope live console brief id mismatch",
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


if __name__ == "__main__":
    unittest.main()
