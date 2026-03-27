#!/usr/bin/env python3
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from live_test_api import read_json


def request_data(
    client: Any,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    expected: tuple[int, ...] = (200,),
    label: str | None = None,
) -> Any:
    response = client.request(method, path, payload=payload, expected=expected, label=label)
    if not isinstance(response, dict) or "data" not in response:
        raise RuntimeError(f"unexpected response payload: {response!r}")
    return response["data"]


def load_list_fixture(fixture_path: Path) -> list[dict[str, Any]]:
    if not fixture_path.is_file():
        return []
    payload = read_json(fixture_path)
    if not isinstance(payload, list):
        raise RuntimeError(f"{fixture_path} must contain a JSON array")
    return [dict(entry) for entry in payload if isinstance(entry, dict)]


def resolve_scalar_value(value: Any, field_name: str) -> str:
    if isinstance(value, str):
        resolved = value.strip()
        if resolved == "":
            raise RuntimeError(f"{field_name} must not be empty")
        return resolved
    if isinstance(value, dict):
        env_name = read_optional_string(value.get("env"))
        if env_name:
            return read_env_value(env_name, field_name)
        template = read_optional_string(value.get("template"))
        if template:
            return substitute_env_template(template, field_name)
    raise RuntimeError(f"{field_name} must be a string or an env/template object")


def substitute_env_template(value: str, field_name: str) -> str:
    def replace(match: re.Match[str]) -> str:
        env_name = match.group(1)
        return read_env_value(env_name, field_name)

    resolved = re.sub(r"\$\{([A-Z0-9_]+)\}", replace, value)
    if resolved.strip() == "":
        raise RuntimeError(f"{field_name} resolved to an empty value")
    return resolved.strip()


def read_env_value(name: str, field_name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value == "":
        raise RuntimeError(f"{field_name} requires environment variable {name}")
    return value


def read_positive_int(value: Any, field_name: str, *, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise RuntimeError(f"{field_name} must be a positive integer")
    return value


def read_required_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise RuntimeError(f"{field_name} is required")
    return value.strip()


def read_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def normalize_slug(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.strip().lower())).strip("-")
