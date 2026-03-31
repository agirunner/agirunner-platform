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

COMPOSE_FILE = str(Path("tmp") / "docker-compose.yml")

from live_test_api import (  # noqa: E402
    ApiClient,
    ApiError,
    CommandError,
    TraceRecorder,
    docker_compose_psql_json,
    docker_exec_text,
    docker_inspect_json,
)


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

    def close(self) -> None:
        return None


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
    def test_request_reauthenticates_once_on_expired_bearer_token(self, urlopen: mock.Mock) -> None:
        refreshed_tokens: list[str] = []

        def refresh_token() -> str:
            refreshed_tokens.append("token-2")
            return "token-2"

        client = ApiClient("http://127.0.0.1:8080").with_bearer_token("token-1", refresh_token)
        urlopen.side_effect = [
            urllib.error.HTTPError(
                url="http://127.0.0.1:8080/api/v1/workflows/wf-1",
                code=401,
                msg="Unauthorized",
                hdrs=None,
                fp=FakeResponse(401, '{"error":{"code":"UNAUTHORIZED","message":"Invalid or expired access token"}}'),
            ),
            FakeResponse(200, '{"data":{"id":"wf-1","state":"active"}}'),
        ]

        response = client.request("GET", "/api/v1/workflows/wf-1", label="workflows.get")

        self.assertEqual({"data": {"id": "wf-1", "state": "active"}}, response)
        self.assertEqual(["token-2"], refreshed_tokens)
        self.assertEqual(2, urlopen.call_count)
        first_request = urlopen.call_args_list[0].args[0]
        second_request = urlopen.call_args_list[1].args[0]
        self.assertEqual("Bearer token-1", first_request.get_header("Authorization"))
        self.assertEqual("Bearer token-2", second_request.get_header("Authorization"))

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
    def test_request_retries_safe_get_on_connection_reset(self, urlopen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            trace = TraceRecorder(tmpdir)
            client = ApiClient(
                "http://127.0.0.1:8080",
                trace=trace,
                safe_read_max_attempts=2,
                safe_read_retry_delay_seconds=0.01,
            )
            urlopen.side_effect = [
                ConnectionResetError(104, "Connection reset by peer"),
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
            self.assertEqual("http.transport_error", trace_lines[1]["event"])

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

    @mock.patch("urllib.request.urlopen")
    def test_request_summarizes_large_logs_response_in_trace(self, urlopen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            trace = TraceRecorder(tmpdir)
            client = ApiClient("http://127.0.0.1:8080", trace=trace)
            body = {
                "data": [
                    {
                        "id": "log-1",
                        "category": "llm",
                        "operation": "llm.chat_stream",
                        "created_at": "2026-03-20T19:00:00Z",
                        "payload": {"messages": ["x" * 50000]},
                    },
                    {
                        "id": "log-2",
                        "category": "tool",
                        "operation": "tool.exec",
                        "created_at": "2026-03-20T19:00:01Z",
                        "payload": {"stdout": "y" * 50000},
                    },
                ],
                "pagination": {"has_more": False, "next_cursor": None},
            }
            urlopen.return_value = FakeResponse(200, json.dumps(body))

            response = client.request("GET", "/api/v1/logs?detail=full", label="logs.list")

            self.assertEqual(body, response)
            trace_lines = [
                json.loads(line)
                for line in (Path(tmpdir) / "api.ndjson").read_text(encoding="utf-8").splitlines()
            ]
            response_event = trace_lines[-1]
            self.assertEqual("http.response", response_event["event"])
            self.assertTrue(response_event["body_omitted"])
            self.assertNotIn("body", response_event)
            self.assertEqual("logs_page", response_event["body_summary"]["kind"])
            self.assertEqual(2, response_event["body_summary"]["row_count"])

    @mock.patch("urllib.request.urlopen")
    def test_request_summarizes_workflow_snapshot_trace(self, urlopen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            trace = TraceRecorder(tmpdir)
            client = ApiClient("http://127.0.0.1:8080", trace=trace)
            body = {
                "data": {
                    "id": "wf-1",
                    "state": "active",
                    "current_stage": "review",
                    "updated_at": "2026-03-20T19:00:00Z",
                    "tasks": [
                        {"id": "t-1", "state": "completed"},
                        {"id": "t-2", "state": "in_progress"},
                    ],
                    "work_items": [
                        {"id": "w-1", "column_id": "done"},
                        {"id": "w-2", "column_id": "in_progress"},
                    ],
                    "activations": [
                        {"id": "a-1", "state": "completed"},
                        {"id": "a-2", "state": "processing"},
                    ],
                }
            }
            urlopen.return_value = FakeResponse(200, json.dumps(body))

            response = client.request("GET", "/api/v1/workflows/wf-1", label="workflows.get")

            self.assertEqual(body, response)
            trace_lines = [
                json.loads(line)
                for line in (Path(tmpdir) / "api.ndjson").read_text(encoding="utf-8").splitlines()
            ]
            response_event = trace_lines[-1]
            self.assertTrue(response_event["body_omitted"])
            self.assertEqual("workflow_snapshot", response_event["body_summary"]["kind"])
            self.assertEqual("wf-1", response_event["body_summary"]["id"])
            self.assertEqual(2, response_event["body_summary"]["task_count"])


class ShellEvidenceHelperTests(unittest.TestCase):
    @mock.patch("subprocess.run")
    def test_docker_compose_psql_json_returns_parsed_payload(self, run: mock.Mock) -> None:
        run.return_value = mock.Mock(returncode=0, stdout='{"workflow":{"id":"wf-1"}}\n', stderr="")

        payload = docker_compose_psql_json(
            compose_file=COMPOSE_FILE,
            compose_project_name="agirunner-platform",
            postgres_user="agirunner",
            postgres_db="agirunner",
            sql="select 1",
        )

        self.assertEqual({"workflow": {"id": "wf-1"}}, payload)
        command = run.call_args.args[0]
        self.assertEqual(
            [
                "docker",
                "compose",
                "-p",
                "agirunner-platform",
                "-f",
                COMPOSE_FILE,
                "exec",
                "-T",
                "postgres",
                "psql",
                "-U",
                "agirunner",
                "-d",
                "agirunner",
                "-At",
                "-c",
                "select 1",
            ],
            command,
        )

    @mock.patch("subprocess.run")
    def test_docker_inspect_json_returns_first_inspected_object(self, run: mock.Mock) -> None:
        run.return_value = mock.Mock(
            returncode=0,
            stdout='[{"Id":"container-1","HostConfig":{"LogConfig":{"Type":"json-file"}}}]',
            stderr="",
        )

        payload = docker_inspect_json("container-1")

        self.assertEqual("container-1", payload["Id"])
        self.assertEqual(
            ["docker", "inspect", "container-1"],
            run.call_args.args[0],
        )

    @mock.patch("subprocess.run")
    def test_docker_exec_text_returns_stdout(self, run: mock.Mock) -> None:
        run.return_value = mock.Mock(returncode=0, stdout="task-1\n", stderr="")

        output = docker_exec_text("runtime-1", "ls -A workspaces/workspace")

        self.assertEqual("task-1", output)
        self.assertEqual(
            ["docker", "exec", "runtime-1", "sh", "-lc", "ls -A workspaces/workspace"],
            run.call_args.args[0],
        )

    @mock.patch("subprocess.run")
    def test_docker_compose_psql_json_raises_command_error_on_failure(self, run: mock.Mock) -> None:
        run.return_value = mock.Mock(returncode=1, stdout="", stderr="permission denied")

        with self.assertRaises(CommandError):
            docker_compose_psql_json(
                compose_file=COMPOSE_FILE,
                compose_project_name="agirunner-platform",
                postgres_user="agirunner",
                postgres_db="agirunner",
                sql="select 1",
            )


if __name__ == "__main__":
    unittest.main()
