#!/usr/bin/env python3
from __future__ import annotations

from typing import Any


NONRECOVERABLE_PROVIDER_PATTERNS = (
    "you have reached your specified api usage limits",
    "usage limits",
    "insufficient_quota",
    "rate limit",
    "billing hard limit",
    "credit balance",
)


def detect_nonrecoverable_provider_blocker(log_rows: list[dict[str, Any]]) -> str | None:
    for row in log_rows:
        message = _row_message(row)
        if not message:
            continue
        normalized = message.lower()
        if any(pattern in normalized for pattern in NONRECOVERABLE_PROVIDER_PATTERNS):
            return message
    return None


def _row_message(row: dict[str, Any]) -> str:
    error = row.get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "").strip()
        if message:
            return message

    payload = row.get("payload")
    if isinstance(payload, dict):
        for key in ("error_message", "response_text", "error"):
            value = payload.get(key)
            if isinstance(value, str):
                message = value.strip()
                if message:
                    return message

    return ""
