#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
import sys

if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from bootstrap import BOOTSTRAP_CONTEXT_PATH, prepare_environment


class BootstrapTests(unittest.TestCase):
    def test_prepare_environment_runs_suite_bootstrap_script_and_reads_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            expected_context = {
                "specialist_model_id": "model-specialist",
                "specialist_reasoning": "medium",
            }
            with patch("bootstrap.results_root", return_value=Path(tmpdir)):
                with patch("bootstrap.run_command") as run_command_mock:
                    with patch("bootstrap.read_json_file", return_value=expected_context) as read_json_mock:
                        context = prepare_environment()

        self.assertEqual(expected_context, context)
        run_command_mock.assert_called_once()
        read_json_mock.assert_called_once_with(Path(tmpdir) / BOOTSTRAP_CONTEXT_PATH)


if __name__ == "__main__":
    unittest.main()
