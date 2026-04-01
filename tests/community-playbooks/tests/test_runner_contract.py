#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
import argparse
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
RUNNER = SUITE_ROOT / "run.sh"
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

import runner as community_runner


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

    def test_execute_bootstrap_only_runs_prepare_environment(self) -> None:
        args = argparse.Namespace(
            bootstrap_only=True,
            import_only=False,
            batch=None,
            playbook=None,
            variant=None,
            failed_only=False,
        )
        with patch("runner.prepare_environment", return_value={"specialist_model_id": "model-1"}) as prepare_mock:
            payload = community_runner.execute(args)

        prepare_mock.assert_called_once_with()
        self.assertEqual({"specialist_model_id": "model-1"}, payload["bootstrap"])

    def test_execute_import_only_runs_import_flow(self) -> None:
        args = argparse.Namespace(
            bootstrap_only=False,
            import_only=True,
            batch=None,
            playbook=None,
            variant=None,
            failed_only=False,
        )
        with patch("runner.run_import_only", return_value={"catalog_playbook_count": 17}) as import_mock:
            payload = community_runner.execute(args)

        import_mock.assert_called_once_with()
        self.assertEqual({"catalog_playbook_count": 17}, payload["import"])
