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
    def test_validate_result_file_accepts_complete_settled_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence = {}
            artifacts = {}
            for key in validate_live_result.REQUIRED_SETTLED_EVIDENCE_KEYS:
                evidence[key] = {"ok": True, "key": key}
                artifact_path = evidence_dir / f"{key}.json"
                artifact_path.write_text(json.dumps(evidence[key]), encoding="utf-8")
                artifacts[key] = str(artifact_path)
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

            self.assertTrue(result.is_valid)
            self.assertEqual([], result.failures)

    def test_validate_result_file_rejects_missing_required_evidence_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scenario_dir = Path(tmpdir) / "scenario"
            evidence_dir = scenario_dir / "evidence"
            evidence_dir.mkdir(parents=True)

            evidence = {}
            artifacts = {}
            missing_key = "runtime_cleanup"
            for key in validate_live_result.REQUIRED_SETTLED_EVIDENCE_KEYS:
                evidence[key] = {"ok": True, "key": key}
                artifact_path = evidence_dir / f"{key}.json"
                artifact_path.write_text(json.dumps(evidence[key]), encoding="utf-8")
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
