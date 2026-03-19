#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

import sys


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

from live_test_api import ApiClient, ApiError, TraceRecorder  # noqa: E402


class FakeResponse:
    def __init__(self, status: int, body: str) -> None:
        self.status = status
        self._body = body

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body.encode("utf-8")


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


class ApiClientTests(unittest.TestCase):
    @mock.patch("urllib.request.urlopen")
    def test_request_retries_safe_get_on_transient_url_error(self, urlopen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            trace = TraceRecorder(tmpdir)
            client = ApiClient(
                "http://127.0.0.1:8080",
                trace=trace,
                safe_read_max_attempts=2,
                safe_read_retry_delay_seconds=0.01,
            )
            urlopen.side_effect = [
                urllib.error.URLError(ConnectionRefusedError(111, "Connection refused")),
                FakeResponse(200, '{"data":{"id":"wf-1","state":"active"}}'),
            ]

            response = client.request("GET", "/api/v1/workflows/wf-1", label="workflows.get")

            self.assertEqual({"data": {"id": "wf-1", "state": "active"}}, response)
            self.assertEqual(2, urlopen.call_count)
            trace_lines = [
                json.loads(line)
                for line in (Path(tmpdir) / "api.ndjson").read_text(encoding="utf-8").splitlines()
            ]
            retry_events = [entry for entry in trace_lines if entry["event"] == "http.retry"]
            self.assertEqual(1, len(retry_events))
            self.assertEqual("workflows.get", retry_events[0]["label"])

    @mock.patch("urllib.request.urlopen")
    def test_request_retries_safe_get_on_transient_http_error(self, urlopen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            trace = TraceRecorder(tmpdir)
            client = ApiClient(
                "http://127.0.0.1:8080",
                trace=trace,
                safe_read_max_attempts=2,
                safe_read_retry_delay_seconds=0.01,
            )
            urlopen.side_effect = [
                urllib.error.HTTPError(
                    url="http://127.0.0.1:8080/api/v1/workflows/wf-1",
                    code=503,
                    msg="Service Unavailable",
                    hdrs=None,
                    fp=None,
                ),
                FakeResponse(200, '{"data":{"id":"wf-1","state":"completed"}}'),
            ]

            response = client.request("GET", "/api/v1/workflows/wf-1", label="workflows.get")

            self.assertEqual({"data": {"id": "wf-1", "state": "completed"}}, response)
            self.assertEqual(2, urlopen.call_count)

    @mock.patch("urllib.request.urlopen")
    def test_request_does_not_retry_mutating_post_on_transient_url_error(self, urlopen: mock.Mock) -> None:
        client = ApiClient(
            "http://127.0.0.1:8080",
            safe_read_max_attempts=3,
            safe_read_retry_delay_seconds=0.01,
        )
        urlopen.side_effect = urllib.error.URLError(ConnectionRefusedError(111, "Connection refused"))

        with self.assertRaises(ApiError):
            client.request("POST", "/api/v1/workflows", payload={"name": "demo"}, label="workflows.create")

        self.assertEqual(1, urlopen.call_count)


if __name__ == "__main__":
    unittest.main()
