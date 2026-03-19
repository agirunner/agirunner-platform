#!/usr/bin/env python3
from __future__ import annotations

import json
import threading
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
    ):
        self.base_url = base_url.rstrip("/")
        self.trace = trace
        self.default_headers = default_headers or {}

    def with_bearer_token(self, token: str) -> "ApiClient":
        headers = {**self.default_headers, "authorization": f"Bearer {token}"}
        return ApiClient(self.base_url, self.trace, headers)

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
            raise ApiError(f"{method} {path} returned {error.code}: {parsed_body}") from error

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


def _parse_body(body: str) -> Any:
    if body.strip() == "":
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body
