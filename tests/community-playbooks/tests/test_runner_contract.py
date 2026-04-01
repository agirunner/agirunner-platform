#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SUITE_ROOT = Path(__file__).resolve().parents[1]
RUNNER = SUITE_ROOT / "run.sh"


class RunnerContractTests(unittest.TestCase):
    def test_help_succeeds(self) -> None:
        completed = subprocess.run(
            ["bash", str(RUNNER), "--help"],
            cwd=SUITE_ROOT.parents[2],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertEqual(0, completed.returncode)
        self.assertIn("Usage:", completed.stdout)

    def test_unknown_batch_is_rejected(self) -> None:
        completed = subprocess.run(
            ["bash", str(RUNNER), "--batch", "bogus"],
            cwd=SUITE_ROOT.parents[2],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(0, completed.returncode)
        self.assertIn("unsupported batch", completed.stderr)

    def test_bootstrap_only_writes_suite_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            completed = subprocess.run(
                ["bash", str(RUNNER), "--bootstrap-only"],
                cwd=SUITE_ROOT.parents[2],
                check=False,
                text=True,
                capture_output=True,
                env={"COMMUNITY_PLAYBOOKS_RESULTS_DIR": tmpdir},
            )
            self.assertEqual(0, completed.returncode, completed.stderr)
            payload = json.loads(Path(tmpdir, "bootstrap", "plan.json").read_text(encoding="utf-8"))
            self.assertEqual(str(SUITE_ROOT), payload["suite_root"])

    def test_import_only_writes_suite_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            completed = subprocess.run(
                ["bash", str(RUNNER), "--import-only"],
                cwd=SUITE_ROOT.parents[2],
                check=False,
                text=True,
                capture_output=True,
                env={"COMMUNITY_PLAYBOOKS_RESULTS_DIR": tmpdir},
            )
            self.assertEqual(0, completed.returncode, completed.stderr)
            payload = json.loads(Path(tmpdir, "import", "plan.json").read_text(encoding="utf-8"))
            self.assertEqual(str(SUITE_ROOT), payload["suite_root"])
