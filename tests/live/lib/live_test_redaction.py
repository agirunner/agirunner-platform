#!/usr/bin/env python3
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit


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
    parsed = urlsplit(candidate)
    if "@" not in parsed.netloc or not parsed.hostname:
        return candidate

    hostname = parsed.hostname
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"

    netloc = hostname
    if parsed.port is not None:
        netloc = f"{netloc}:{parsed.port}"

    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))
