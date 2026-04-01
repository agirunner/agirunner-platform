#!/usr/bin/env python3
from __future__ import annotations

import re
from typing import Any


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

_CREDENTIAL_URL_RE = re.compile(r"https?://[^\s/@]+(?::[^@\s/]*)?@[^\s'\"<>]+")


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
    if isinstance(value, str):
        return _redact_credential_urls(value)
    return value


def _redact_credential_urls(text: str) -> str:
    return _CREDENTIAL_URL_RE.sub(_strip_url_userinfo, text)


def _strip_url_userinfo(match: re.Match[str]) -> str:
    candidate = match.group(0)
    scheme, separator, remainder = candidate.partition("://")
    if separator == "":
        return candidate

    boundary = len(remainder)
    for marker in ("/", "?", "#"):
        marker_index = remainder.find(marker)
        if marker_index >= 0:
            boundary = min(boundary, marker_index)

    authority = remainder[:boundary]
    suffix = remainder[boundary:]
    if "@" not in authority:
        return candidate

    _, _, stripped_authority = authority.rpartition("@")
    if stripped_authority == "":
        return candidate

    return f"{scheme}{separator}{stripped_authority}{suffix}"
