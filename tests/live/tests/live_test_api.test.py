#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import sys


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

from live_test_api import TraceRecorder  # noqa: E402


class TraceRecorderTests(unittest.TestCase):
    def test_record_recreates_deleted_trace_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            trace_dir = Path(tmpdir) / "scenario" / "trace"
            recorder = TraceRecorder(str(trace_dir))
            shutil.rmtree(trace_dir)

            recorder.record({"event": "http.request", "path": "/api/v1/workflows"})

            trace_file = trace_dir / "api.ndjson"
            self.assertTrue(trace_file.is_file())
            payload = json.loads(trace_file.read_text(encoding="utf-8").strip())
            self.assertEqual("http.request", payload["event"])


if __name__ == "__main__":
    unittest.main()
