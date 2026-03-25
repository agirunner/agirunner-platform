#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
import urllib.error
import urllib.request

SENSITIVE_KEYS = {
    "apiKeySecretRef",
    "api_key",
    "api_key_secret_ref",
    "authorization",
    "git_token",
    "secret",
    "secret_ref",
    "token",
}
SAFE_READ_METHODS = {"GET", "HEAD", "OPTIONS"}
TRANSIENT_HTTP_STATUS_CODES = {502, 503, 504}
DEFAULT_SAFE_READ_MAX_ATTEMPTS = 24
DEFAULT_SAFE_READ_RETRY_DELAY_SECONDS = 5.0
TRACE_INLINE_BODY_MAX_BYTES = 16_384
TRACE_LIST_PREVIEW_COUNT = 3


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact_json(value: Any, parent_key: str | None = None) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if key in SENSITIVE_KEYS:
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = redact_json(item, key)
        return redacted
    if isinstance(value, list):
        return [redact_json(item, parent_key) for item in value]
    if parent_key in SENSITIVE_KEYS and isinstance(value, str):
        return "***REDACTED***"
    return value


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_json(path: str | Path, payload: Any) -> None:
    target = Path(path)
    ensure_parent(target)
    target.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


class ApiError(RuntimeError):
    pass


class CommandError(RuntimeError):
    pass


class TraceRecorder:
    def __init__(self, root_dir: str):
        self.root_dir = Path(root_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self.trace_file = self.root_dir / "api.ndjson"
        self._write_lock = threading.Lock()

    def record(self, payload: dict[str, Any]) -> None:
        payload = {"timestamp": _timestamp(), **payload}
        with self._write_lock:
            self.root_dir.mkdir(parents=True, exist_ok=True)
            with self.trace_file.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, sort_keys=True) + "\n")


class ApiClient:
    def __init__(
        self,
        base_url: str,
        trace: TraceRecorder | None = None,
        default_headers: dict[str, str] | None = None,
        *,
        safe_read_max_attempts: int = DEFAULT_SAFE_READ_MAX_ATTEMPTS,
        safe_read_retry_delay_seconds: float = DEFAULT_SAFE_READ_RETRY_DELAY_SECONDS,
        refresh_bearer_token: Callable[[], str] | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.trace = trace
        self.default_headers = default_headers or {}
        self.safe_read_max_attempts = max(1, safe_read_max_attempts)
        self.safe_read_retry_delay_seconds = max(0.0, safe_read_retry_delay_seconds)
        self.refresh_bearer_token = refresh_bearer_token

    def with_bearer_token(
        self,
        token: str,
        refresh_bearer_token: Callable[[], str] | None = None,
    ) -> "ApiClient":
        headers = {**self.default_headers, "authorization": f"Bearer {token}"}
        return ApiClient(
            self.base_url,
            self.trace,
            headers,
            safe_read_max_attempts=self.safe_read_max_attempts,
            safe_read_retry_delay_seconds=self.safe_read_retry_delay_seconds,
            refresh_bearer_token=refresh_bearer_token,
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        headers = dict(self.default_headers)
        body_bytes: bytes | None = None
        if payload is not None:
            body_bytes = json.dumps(payload).encode("utf-8")

        if self.trace is not None:
            self.trace.record(
                {
                    "event": "http.request",
                    "label": label or path,
                    "method": method,
                    "path": path,
                    "payload": redact_json(payload),
                }
            )

        attempts = self._attempt_budget(method)
        refreshed_auth = False
        for attempt in range(1, attempts + 1):
            headers = dict(self.default_headers)
            if payload is not None:
                headers["content-type"] = "application/json"
            request = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    response_body = response.read().decode("utf-8")
                    parsed_body = _parse_body(response_body)
                    self._record_response(label or path, method, path, response.status, parsed_body)
                    if response.status not in expected:
                        raise ApiError(f"{method} {path} returned unexpected status {response.status}")
                    return parsed_body
            except urllib.error.HTTPError as error:
                response_body = error.read().decode("utf-8")
                parsed_body = _parse_body(response_body)
                self._record_response(label or path, method, path, error.code, parsed_body)
                if self._should_refresh_auth(error.code, parsed_body, refreshed_auth):
                    self._record_retry(label or path, method, path, attempt, attempts, "reauth:401")
                    self._refresh_bearer_header()
                    refreshed_auth = True
                    continue
                if self._should_retry_http_error(method, error.code, attempt, attempts):
                    self._record_retry(label or path, method, path, attempt, attempts, f"http:{error.code}")
                    time.sleep(self.safe_read_retry_delay_seconds)
                    continue
                raise ApiError(f"{method} {path} returned {error.code}: {parsed_body}") from error
            except urllib.error.URLError as error:
                self._record_transport_error(label or path, method, path, error)
                if self._should_retry_url_error(method, attempt, attempts):
                    self._record_retry(label or path, method, path, attempt, attempts, f"url:{error}")
                    time.sleep(self.safe_read_retry_delay_seconds)
                    continue
                raise ApiError(f"{method} {path} transport failed: {error}") from error
            except OSError as error:
                self._record_transport_error(label or path, method, path, error)
                if self._should_retry_url_error(method, attempt, attempts):
                    self._record_retry(
                        label or path,
                        method,
                        path,
                        attempt,
                        attempts,
                        f"os:{type(error).__name__}:{error}",
                    )
                    time.sleep(self.safe_read_retry_delay_seconds)
                    continue
                raise ApiError(f"{method} {path} transport failed: {error}") from error
        raise ApiError(f"{method} {path} exhausted retry budget")

    def best_effort_request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, Any]:
        try:
            return {"ok": True, "data": self.request(method, path, payload=payload, expected=expected, label=label)}
        except ApiError as error:
            return {"ok": False, "error": str(error)}

    def _record_response(self, label: str, method: str, path: str, status: int, body: Any) -> None:
        if self.trace is None:
            return
        self.trace.record(_build_trace_response_event(label, method, path, status, redact_json(body)))

    def _record_transport_error(self, label: str, method: str, path: str, error: Exception) -> None:
        if self.trace is None:
            return
        self.trace.record(
            {
                "event": "http.transport_error",
                "label": label,
                "method": method,
                "path": path,
                "error": str(error),
            }
        )

    def _record_retry(
        self,
        label: str,
        method: str,
        path: str,
        attempt: int,
        attempts: int,
        reason: str,
    ) -> None:
        if self.trace is None:
            return
        self.trace.record(
            {
                "event": "http.retry",
                "label": label,
                "method": method,
                "path": path,
                "attempt": attempt,
                "max_attempts": attempts,
                "retry_delay_seconds": self.safe_read_retry_delay_seconds,
                "reason": reason,
            }
        )

    def _attempt_budget(self, method: str) -> int:
        if method.upper() not in SAFE_READ_METHODS:
            return 1
        return self.safe_read_max_attempts

    def _should_retry_http_error(self, method: str, status_code: int, attempt: int, attempts: int) -> bool:
        return (
            method.upper() in SAFE_READ_METHODS
            and attempt < attempts
            and status_code in TRANSIENT_HTTP_STATUS_CODES
        )

    def _should_retry_url_error(self, method: str, attempt: int, attempts: int) -> bool:
        return method.upper() in SAFE_READ_METHODS and attempt < attempts

    def _should_refresh_auth(self, status_code: int, parsed_body: Any, refreshed_auth: bool) -> bool:
        if refreshed_auth or status_code != 401 or self.refresh_bearer_token is None:
            return False
        if not isinstance(parsed_body, dict):
            return False
        error = parsed_body.get("error")
        if not isinstance(error, dict):
            return False
        code = str(error.get("code") or "").strip().upper()
        message = str(error.get("message") or "").strip().lower()
        return code == "UNAUTHORIZED" and "expired access token" in message

    def _refresh_bearer_header(self) -> None:
        if self.refresh_bearer_token is None:
            return
        token = self.refresh_bearer_token().strip()
        if token:
            self.default_headers["authorization"] = f"Bearer {token}"


def _parse_body(body: str) -> Any:
    if body.strip() == "":
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def run_command(
    command: list[str],
    *,
    label: str,
    trace: TraceRecorder | None = None,
) -> str:
    if trace is not None:
        trace.record({"event": "shell.command", "label": label, "command": command})
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if trace is not None:
        trace.record(
            {
                "event": "shell.result",
                "label": label,
                "command": command,
                "returncode": result.returncode,
                "stdout_preview": stdout[:512],
                "stderr_preview": stderr[:512],
            }
        )
    if result.returncode != 0:
        message = f"{label} failed with exit code {result.returncode}"
        if stderr:
            message += f": {stderr}"
        raise CommandError(message)
    return stdout


def docker_compose_psql_json(
    *,
    compose_file: str,
    compose_project_name: str,
    postgres_user: str,
    postgres_db: str,
    sql: str,
    trace: TraceRecorder | None = None,
) -> Any:
    stdout = run_command(
        [
            "docker",
            "compose",
            "-p",
            compose_project_name,
            "-f",
            compose_file,
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            postgres_user,
            "-d",
            postgres_db,
            "-At",
            "-c",
            sql,
        ],
        label="docker_compose_psql_json",
        trace=trace,
    )
    if stdout == "":
        raise CommandError("docker_compose_psql_json returned empty output")
    return json.loads(stdout)


def docker_inspect_json(container_id: str, *, trace: TraceRecorder | None = None) -> dict[str, Any]:
    stdout = run_command(
        ["docker", "inspect", container_id],
        label=f"docker_inspect:{container_id}",
        trace=trace,
    )
    payload = json.loads(stdout)
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
        raise CommandError(f"docker_inspect:{container_id} returned invalid payload")
    return payload[0]


def docker_exec_text(
    container_id: str,
    shell_command: str,
    *,
    trace: TraceRecorder | None = None,
) -> str:
    return run_command(
        ["docker", "exec", container_id, "sh", "-lc", shell_command],
        label=f"docker_exec:{container_id}",
        trace=trace,
    )


def _build_trace_response_event(
    label: str,
    method: str,
    path: str,
    status: int,
    body: Any,
) -> dict[str, Any]:
    event = {
        "event": "http.response",
        "label": label,
        "method": method,
        "path": path,
        "status": status,
    }
    encoded_body = json.dumps(body, sort_keys=True)
    body_bytes = len(encoded_body.encode("utf-8"))
    summary = _summarize_trace_body(label, path, body)
    if summary is not None:
        event["body_summary"] = summary
        event["body_bytes"] = body_bytes
        event["body_omitted"] = True
        return event
    if body_bytes <= TRACE_INLINE_BODY_MAX_BYTES:
        event["body"] = body
        return event
    event["body_summary"] = _summarize_large_body(body)
    event["body_bytes"] = body_bytes
    event["body_omitted"] = True
    return event


def _summarize_trace_body(label: str, path: str, body: Any) -> dict[str, Any] | None:
    if _is_logs_response(label, path):
        return _summarize_logs_response(body)
    if _is_workflow_snapshot_response(label, path):
        return _summarize_workflow_response(body)
    if label.startswith("workflows.work-items"):
        return _summarize_work_items_response(body)
    if label.startswith("approvals."):
        return _summarize_approvals_response(body)
    if label.startswith("fleet.status"):
        return _summarize_fleet_response(body)
    return None


def _is_logs_response(label: str, path: str) -> bool:
    return label == "logs.list" or path.startswith("/api/v1/logs")


def _is_workflow_snapshot_response(label: str, path: str) -> bool:
    return label == "workflows.get" or (path.startswith("/api/v1/workflows/") and "/board" not in path and "/work-items" not in path)


def _summarize_logs_response(body: Any) -> dict[str, Any]:
    data = body.get("data", []) if isinstance(body, dict) else []
    rows = data if isinstance(data, list) else []
    pagination = body.get("pagination", {}) if isinstance(body, dict) else {}
    return {
        "kind": "logs_page",
        "row_count": len(rows),
        "categories": _count_values(rows, "category"),
        "operations": _count_values(rows, "operation"),
        "first_id": _safe_row_value(rows, 0, "id"),
        "last_id": _safe_row_value(rows, -1, "id"),
        "first_created_at": _safe_row_value(rows, 0, "created_at"),
        "last_created_at": _safe_row_value(rows, -1, "created_at"),
        "has_more": bool(pagination.get("has_more")) if isinstance(pagination, dict) else False,
        "next_cursor_present": bool(pagination.get("next_cursor")) if isinstance(pagination, dict) else False,
    }


def _summarize_workflow_response(body: Any) -> dict[str, Any]:
    data = body.get("data", {}) if isinstance(body, dict) else {}
    tasks = data.get("tasks", []) if isinstance(data, dict) else []
    work_items = data.get("work_items", []) if isinstance(data, dict) else []
    activations = data.get("activations", []) if isinstance(data, dict) else []
    return {
        "kind": "workflow_snapshot",
        "id": data.get("id") if isinstance(data, dict) else None,
        "state": data.get("state") if isinstance(data, dict) else None,
        "current_stage": data.get("current_stage") if isinstance(data, dict) else None,
        "updated_at": data.get("updated_at") if isinstance(data, dict) else None,
        "completed_at": data.get("completed_at") if isinstance(data, dict) else None,
        "task_count": len(tasks) if isinstance(tasks, list) else 0,
        "task_states": _count_fallback_values(tasks, ("state", "status")),
        "work_item_count": len(work_items) if isinstance(work_items, list) else 0,
        "work_item_states": _count_fallback_values(work_items, ("column_id", "state", "status")),
        "activation_count": len(activations) if isinstance(activations, list) else 0,
        "activation_states": _count_fallback_values(activations, ("state",)),
    }


def _summarize_work_items_response(body: Any) -> dict[str, Any]:
    rows = body.get("data", []) if isinstance(body, dict) else []
    items = rows if isinstance(rows, list) else []
    return {
        "kind": "work_items",
        "count": len(items),
        "states": _count_fallback_values(items, ("column_id", "state", "status")),
        "preview_ids": _preview_ids(items),
    }


def _summarize_approvals_response(body: Any) -> dict[str, Any]:
    data = body.get("data", {}) if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        return {"kind": "approvals", "stage_gate_count": 0, "task_approval_count": 0}
    return {
        "kind": "approvals",
        "stage_gate_count": len(data.get("stage_gates", [])) if isinstance(data.get("stage_gates"), list) else 0,
        "task_approval_count": len(data.get("task_approvals", [])) if isinstance(data.get("task_approvals"), list) else 0,
    }


def _summarize_fleet_response(body: Any) -> dict[str, Any]:
    data = body.get("data", {}) if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        return {"kind": "fleet"}
    summary = {"kind": "fleet"}
    for key in ("running_runtimes", "executing_runtimes", "active_workflows", "global_max_runtimes"):
        if key in data:
            summary[key] = data.get(key)
    recent_events = data.get("recent_events", [])
    if isinstance(recent_events, list):
        summary["recent_event_count"] = len(recent_events)
        summary["recent_event_types"] = _count_values(recent_events, "event_type")
    return summary


def _summarize_large_body(body: Any) -> dict[str, Any]:
    if isinstance(body, dict):
        return {
            "kind": "dict",
            "key_count": len(body),
            "keys": sorted(body.keys())[:TRACE_LIST_PREVIEW_COUNT],
        }
    if isinstance(body, list):
        return {
            "kind": "list",
            "length": len(body),
            "preview_ids": _preview_ids(body),
        }
    preview = str(body)
    if len(preview) > TRACE_INLINE_BODY_MAX_BYTES:
        preview = preview[:TRACE_INLINE_BODY_MAX_BYTES] + "...<truncated>"
    return {
        "kind": type(body).__name__,
        "preview": preview,
    }


def _count_values(rows: list[Any], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get(key)
        if value in (None, ""):
            continue
        name = str(value)
        counts[name] = counts.get(name, 0) + 1
    return counts


def _count_fallback_values(rows: list[Any], keys: tuple[str, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = None
        for key in keys:
            candidate = row.get(key)
            if candidate not in (None, ""):
                value = candidate
                break
        name = str(value) if value is not None else "unknown"
        counts[name] = counts.get(name, 0) + 1
    return counts


def _preview_ids(rows: list[Any]) -> list[str]:
    preview: list[str] = []
    for row in rows[:TRACE_LIST_PREVIEW_COUNT]:
        if not isinstance(row, dict):
            continue
        value = row.get("id")
        if isinstance(value, str) and value.strip():
            preview.append(value)
    return preview


def _safe_row_value(rows: list[Any], index: int, key: str) -> Any:
    if not rows:
        return None
    row = rows[index]
    if not isinstance(row, dict):
        return None
    return row.get(key)
