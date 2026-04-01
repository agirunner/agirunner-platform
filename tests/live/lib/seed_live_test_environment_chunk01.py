#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from hashlib import sha256
from pathlib import Path
from typing import Any

from live_test_api import ApiClient, TraceRecorder, read_json
from scenario_config import load_scenario
from specialist_capability_fixtures import (
    resolve_role_capability_refs,
    sync_profile_capabilities,
)

NATIVE_SEARCH_TOOL = "native_search"
NATIVE_SEARCH_MODEL_PREFIXES: dict[str, tuple[str, ...]] = {
    "openai": (
        "gpt-5.4-pro",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5.3-codex",
        "gpt-5.2",
        "gpt-5.2-pro",
        "gpt-5.2-codex",
        "gpt-5.1-codex-max",
        "gpt-5.1-codex",
        "gpt-5.1",
        "gpt-5-pro",
        "gpt-5",
        "gpt-5-codex",
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-5-codex-mini",
        "o4-mini",
        "o3",
        "o3-pro",
        "o3-mini",
        "o1",
        "o1-pro",
    ),
    "anthropic": (
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-opus-4-1",
        "claude-sonnet-4",
        "claude-opus-4",
        "claude-3-5-haiku",
    ),
    "google": (
        "gemini-3.1-pro-preview",
        "gemini-3-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
    ),
    "gemini": (
        "gemini-3.1-pro-preview",
        "gemini-3-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
    ),
}


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def extract_data(response: Any) -> Any:
    if not isinstance(response, dict) or "data" not in response:
        raise RuntimeError(f"unexpected response payload: {response!r}")
    return response["data"]


def login(client: ApiClient, admin_api_key: str) -> str:
    response = client.request(
        "POST",
        "/api/v1/auth/login",
        payload={"api_key": admin_api_key},
        expected=(200,),
        label="auth.login",
    )
    data = extract_data(response)
    token = data.get("token")
    if not isinstance(token, str) or token.strip() == "":
        raise RuntimeError("auth login did not return a token")
    return token


def find_worker(workers: list[dict[str, Any]], worker_name: str) -> dict[str, Any]:
    for worker in workers:
        if worker.get("worker_name") == worker_name:
            return worker
    raise RuntimeError(f"worker not found: {worker_name}")


def delete_models_and_providers(client: ApiClient) -> None:
    models = extract_data(client.request("GET", "/api/v1/config/llm/models", label="llm.models.list"))
    for model in models:
        client.request(
            "DELETE",
            f"/api/v1/config/llm/models/{model['id']}",
            expected=(204,),
            label=f"llm.models.delete:{model['id']}",
        )

    providers = extract_data(client.request("GET", "/api/v1/config/llm/providers", label="llm.providers.list"))
    for provider in providers:
        client.request(
            "DELETE",
            f"/api/v1/config/llm/providers/{provider['id']}",
            expected=(204,),
            label=f"llm.providers.delete:{provider['id']}",
        )


def clear_assignments(client: ApiClient) -> None:
    assignments = extract_data(client.request("GET", "/api/v1/config/llm/assignments", label="llm.assignments.list"))
    for assignment in assignments:
        role_name = assignment["role_name"]
        client.request(
            "PUT",
            f"/api/v1/config/llm/assignments/{role_name}",
            payload={"primaryModelId": None, "reasoningConfig": None},
            expected=(200,),
            label=f"llm.assignments.clear:{role_name}",
        )


def delete_workspaces(client: ApiClient) -> None:
    workspaces = extract_data(client.request("GET", "/api/v1/workspaces", label="workspaces.list"))
    for workspace in workspaces:
        client.request(
            "DELETE",
            f"/api/v1/workspaces/{workspace['id']}?cascade=true",
            expected=(200,),
            label=f"workspaces.delete:{workspace['id']}",
        )


def load_fixture(path: str) -> Any:
    fixture_path = Path(path)
    if not fixture_path.is_file():
        raise RuntimeError(f"fixture not found: {path}")
    return read_json(fixture_path)


def model_supports_native_search(provider_type: str | None, model_id: str | None) -> bool:
    normalized_provider = (provider_type or "").strip().lower()
    normalized_model = (model_id or "").strip()
    if not normalized_provider or not normalized_model:
        return False

    for prefix in NATIVE_SEARCH_MODEL_PREFIXES.get(normalized_provider, ()):
        if normalized_model == prefix or normalized_model.startswith(f"{prefix}-"):
            return True
    return False


def apply_native_search_default(
    payload: dict[str, Any],
    *,
    provider_type: str | None,
    resolved_model_id: str | None,
) -> dict[str, Any]:
    next_payload = dict(payload)
    allowed_tools = next_payload.get("allowedTools")
    if not isinstance(allowed_tools, list):
        return next_payload
    if not model_supports_native_search(provider_type, resolved_model_id):
        return next_payload

    normalized_tools = [tool for tool in allowed_tools if isinstance(tool, str) and tool.strip()]
    if NATIVE_SEARCH_TOOL not in normalized_tools:
        normalized_tools.append(NATIVE_SEARCH_TOOL)
    next_payload["allowedTools"] = normalized_tools
    return next_payload


def summarize_execution_environment(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: payload.get(key)
        for key in (
            "id",
            "slug",
            "name",
            "source_kind",
            "catalog_key",
            "catalog_version",
            "image",
            "cpu",
            "memory",
            "pull_policy",
            "compatibility_status",
            "compatibility_errors",
            "is_claimable",
            "is_archived",
            "verified_metadata",
            "tool_capabilities",
        )
    }


def list_execution_environments(client: ApiClient) -> list[dict[str, Any]]:
    environments = extract_data(
        client.request("GET", "/api/v1/execution-environments", expected=(200,), label="execution-environments.list")
    )
    if not isinstance(environments, list):
        raise RuntimeError("execution environments list response must be an array")
    return [dict(item) for item in environments if isinstance(item, dict)]


def _is_claimable_execution_environment(environment: dict[str, Any]) -> bool:
    return bool(environment.get("is_claimable")) and not bool(environment.get("is_archived"))


def _find_execution_environment_by_name(
    environments: list[dict[str, Any]],
    name: str,
) -> dict[str, Any] | None:
    normalized_name = name.strip().lower()
    for environment in environments:
        if str(environment.get("name") or "").strip().lower() == normalized_name:
            return environment
    return None



__all__ = [name for name in globals() if not name.startswith("__")]
