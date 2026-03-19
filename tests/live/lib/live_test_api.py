#!/usr/bin/env python3
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
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
    ):
        self.base_url = base_url.rstrip("/")
        self.trace = trace
        self.default_headers = default_headers or {}
        self.safe_read_max_attempts = max(1, safe_read_max_attempts)
        self.safe_read_retry_delay_seconds = max(0.0, safe_read_retry_delay_seconds)

    def with_bearer_token(self, token: str) -> "ApiClient":
        headers = {**self.default_headers, "authorization": f"Bearer {token}"}
        return ApiClient(
            self.base_url,
            self.trace,
            headers,
            safe_read_max_attempts=self.safe_read_max_attempts,
            safe_read_retry_delay_seconds=self.safe_read_retry_delay_seconds,
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
            headers["content-type"] = "application/json"
            body_bytes = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

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
        for attempt in range(1, attempts + 1):
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
        self.trace.record(
            {
                "event": "http.response",
                "label": label,
                "method": method,
                "path": path,
                "status": status,
                "body": redact_json(body),
            }
        )

    def _record_transport_error(self, label: str, method: str, path: str, error: urllib.error.URLError) -> None:
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


def _parse_body(body: str) -> Any:
    if body.strip() == "":
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body
