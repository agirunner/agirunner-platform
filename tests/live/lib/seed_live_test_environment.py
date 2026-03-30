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
        "claude-opus-4-5",
        "claude-sonnet-4-5",
        "claude-opus-4-1",
        "claude-sonnet-4",
        "claude-opus-4",
        "claude-haiku-4-5",
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


def ensure_live_test_execution_environments(client: ApiClient) -> dict[str, Any]:
    environments = list_execution_environments(client)
    default_candidates = [
        summarize_execution_environment(environment)
        for environment in environments
        if _is_claimable_execution_environment(environment) and environment.get("source_kind") == "catalog"
    ]
    if not default_candidates:
        raise RuntimeError("live test bootstrap requires at least one claimable catalog execution environment")

    aliases: dict[str, dict[str, Any]] = {}
    for candidate in default_candidates:
        for alias in (
            candidate.get("slug"),
            candidate.get("catalog_key"),
        ):
            if not isinstance(alias, str) or alias.strip() == "":
                continue
            aliases[alias.strip()] = dict(candidate)

    return {
        "default_candidates": default_candidates,
        "aliases": aliases,
    }


def resolve_execution_environment_alias(
    payload: dict[str, Any],
    *,
    execution_environment_aliases: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    next_payload = dict(payload)
    alias = next_payload.pop("executionEnvironmentAlias", None)
    if alias is None:
        return next_payload
    if "executionEnvironmentId" in next_payload:
        raise RuntimeError("roles fixture must not provide both executionEnvironmentAlias and executionEnvironmentId")
    if not isinstance(alias, str) or alias.strip() == "":
        raise RuntimeError("executionEnvironmentAlias must be a non-empty string")
    aliases = execution_environment_aliases or {}
    resolved = aliases.get(alias.strip())
    if not isinstance(resolved, dict):
        raise RuntimeError(f"unknown execution environment alias: {alias}")
    environment_id = resolved.get("id")
    if not isinstance(environment_id, str) or environment_id.strip() == "":
        raise RuntimeError(f"execution environment alias {alias} is missing an id")
    next_payload["executionEnvironmentId"] = environment_id.strip()
    return next_payload


def _role_prefers_default_execution_environment(payload: dict[str, Any]) -> bool:
    value = payload.pop("useDefaultExecutionEnvironment", False)
    if not isinstance(value, bool):
        raise RuntimeError("useDefaultExecutionEnvironment must be a boolean when provided")
    return value


def _assign_catalog_execution_environment(
    payload: dict[str, Any],
    *,
    default_execution_environment_candidates: list[dict[str, Any]] | None,
    selection_seed: str | None = None,
) -> dict[str, Any]:
    next_payload = dict(payload)
    if "executionEnvironmentId" in next_payload:
        return next_payload
    candidates = default_execution_environment_candidates or []
    if not candidates:
        return next_payload
    role_name = str(next_payload.get("name") or "").strip()
    if role_name == "":
        raise RuntimeError("role name is required before assigning an execution environment")
    selection_key = role_name if not selection_seed else f"{selection_seed}:{role_name}"
    index = int.from_bytes(sha256(selection_key.encode("utf-8")).digest()[:8], "big") % len(candidates)
    candidate = candidates[index]
    environment_id = str(candidate.get("id") or "").strip()
    if environment_id == "":
        raise RuntimeError("default execution environment candidate is missing an id")
    next_payload["executionEnvironmentId"] = environment_id
    return next_payload


def sync_roles(
    client: ApiClient,
    roles_fixture_path: str,
    *,
    provider_type: str | None = None,
    resolved_model_id: str | None = None,
    execution_environment_aliases: dict[str, dict[str, Any]] | None = None,
    default_execution_environment_candidates: list[dict[str, Any]] | None = None,
    execution_environment_selection_seed: str | None = None,
    specialist_capability_registry: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    existing_roles = extract_data(
        client.request("GET", "/api/v1/config/roles", expected=(200,), label="roles.list")
    )
    existing_by_name = {role["name"]: role for role in existing_roles}
    synced_roles: list[dict[str, Any]] = []

    for payload in load_fixture(roles_fixture_path):
        synced_payload, _ = resolve_role_capability_refs(
            payload,
            registry={} if specialist_capability_registry is None else specialist_capability_registry,
        )
        synced_payload = apply_native_search_default(
            synced_payload,
            provider_type=provider_type,
            resolved_model_id=resolved_model_id,
        )
        use_default_execution_environment = _role_prefers_default_execution_environment(synced_payload)
        synced_payload = resolve_execution_environment_alias(
            synced_payload,
            execution_environment_aliases=execution_environment_aliases,
        )
        if use_default_execution_environment:
            if "executionEnvironmentId" in synced_payload:
                raise RuntimeError(
                    "roles fixture must not provide executionEnvironmentId when useDefaultExecutionEnvironment is true"
                )
        else:
            synced_payload = _assign_catalog_execution_environment(
                synced_payload,
                default_execution_environment_candidates=default_execution_environment_candidates,
                selection_seed=execution_environment_selection_seed,
            )
        existing = existing_by_name.get(synced_payload["name"])
        if existing is None:
            role = extract_data(
                client.request(
                    "POST",
                    "/api/v1/config/roles",
                    payload=synced_payload,
                    expected=(201,),
                    label=f"roles.create:{synced_payload['name']}",
                )
            )
        else:
            role = extract_data(
                client.request(
                    "PUT",
                    f"/api/v1/config/roles/{existing['id']}",
                    payload=synced_payload,
                    expected=(200,),
                    label=f"roles.update:{synced_payload['name']}",
                )
            )
        synced_roles.append(role)

    return synced_roles


def sync_playbook(client: ApiClient, playbook_fixture_path: str) -> dict[str, Any]:
    payload = load_fixture(playbook_fixture_path)
    existing_playbooks = extract_data(
        client.request("GET", "/api/v1/playbooks", expected=(200,), label="playbooks.list")
    )
    existing = next(
        (playbook for playbook in existing_playbooks if playbook.get("slug") == payload["slug"]),
        None,
    )

    if existing is None:
        return extract_data(
            client.request(
                "POST",
                "/api/v1/playbooks",
                payload=payload,
                expected=(201,),
                label=f"playbooks.create:{payload['slug']}",
            )
        )

    return extract_data(
        client.request(
            "PUT",
            f"/api/v1/playbooks/{existing['id']}",
            payload=payload,
            expected=(200,),
            label=f"playbooks.update:{payload['slug']}",
        )
    )


def read_playbook_launch_inputs(playbook_fixture_path: str) -> list[dict[str, Any]]:
    payload = load_fixture(playbook_fixture_path)
    if not isinstance(payload, dict):
        raise RuntimeError("playbook fixture must contain an object")
    definition = payload.get("definition")
    if not isinstance(definition, dict):
        return []
    parameters = definition.get("parameters")
    if not isinstance(parameters, list):
        return []

    launch_inputs: list[dict[str, Any]] = []
    for parameter in parameters:
        if not isinstance(parameter, dict):
            continue
        slug = str(parameter.get("slug") or "").strip()
        title = str(parameter.get("title") or "").strip()
        if slug == "" or title == "":
            continue
        launch_inputs.append(
            {
                "slug": slug,
                "title": title,
                "required": bool(parameter.get("required", False)),
            }
        )
    return launch_inputs


def sync_library_profiles(
    client: ApiClient,
    *,
    library_root: str,
    provider_type: str | None = None,
    resolved_model_id: str | None = None,
    execution_environment_aliases: dict[str, dict[str, Any]] | None = None,
    default_execution_environment_candidates: list[dict[str, Any]] | None = None,
    execution_environment_selection_seed: str | None = None,
) -> dict[str, dict[str, Any]]:
    registry: dict[str, dict[str, Any]] = {}
    library_path = Path(library_root)
    for profile_dir in sorted(path for path in library_path.iterdir() if path.is_dir()):
        roles_fixture = profile_dir / "roles.json"
        playbook_fixture = profile_dir / "playbook.json"
        if not roles_fixture.is_file() or not playbook_fixture.is_file():
            continue
        specialist_capability_registry = sync_profile_capabilities(client, profile_dir=profile_dir)

        roles = sync_roles(
            client,
            str(roles_fixture),
            provider_type=provider_type,
            resolved_model_id=resolved_model_id,
            execution_environment_aliases=execution_environment_aliases,
            default_execution_environment_candidates=default_execution_environment_candidates,
            execution_environment_selection_seed=execution_environment_selection_seed,
            specialist_capability_registry=specialist_capability_registry,
        )
        fixture_roles = load_fixture(str(roles_fixture))
        fixture_roles_by_name = {
            str(role.get("name") or "").strip(): role
            for role in fixture_roles
            if isinstance(role, dict) and isinstance(role.get("name"), str)
        }
        playbook = sync_playbook(client, str(playbook_fixture))
        playbook_launch_inputs = read_playbook_launch_inputs(str(playbook_fixture))
        registry[profile_dir.name] = {
            "playbook_id": playbook["id"],
            "playbook_slug": playbook["slug"],
            "playbook_launch_inputs": playbook_launch_inputs,
            "role_names": [role["name"] for role in roles],
            "skills": specialist_capability_registry["skills"],
            "remote_mcp_servers": specialist_capability_registry["remote_mcp_servers"],
            "roles": [
                {
                    "name": role["name"],
                    "execution_environment_id": role.get("execution_environment_id"),
                    "use_default_execution_environment": bool(
                        fixture_roles_by_name.get(str(role.get("name") or "").strip(), {}).get(
                            "useDefaultExecutionEnvironment"
                        )
                    ),
                    "skill_slugs": list(
                        fixture_roles_by_name.get(str(role.get("name") or "").strip(), {}).get("skillSlugs", [])
                    ),
                    "mcp_server_slugs": list(
                        fixture_roles_by_name.get(str(role.get("name") or "").strip(), {}).get("mcpServerSlugs", [])
                    ),
                }
                for role in roles
            ],
        }
    return registry


def reasoning_config(default_effort: str) -> dict[str, Any]:
    return {
        "type": "effort",
        "options": ["none", "low", "medium", "high", "xhigh"],
        "default": default_effort,
    }


def reasoning_assignment(effort: str) -> dict[str, str]:
    return {"effort": effort, "reasoning_effort": effort}


def find_model(
    models: list[dict[str, Any]],
    *,
    provider_id: str,
    model_id: str,
    endpoint_type: str,
) -> dict[str, Any] | None:
    for model in models:
        if (
            model.get("provider_id") == provider_id
            and model.get("model_id") == model_id
            and model.get("endpoint_type") == endpoint_type
        ):
            return model
    return None


def create_model(
    client: ApiClient,
    *,
    provider_id: str,
    model_id: str,
    endpoint_type: str,
    default_reasoning_effort: str,
    label: str,
) -> dict[str, Any]:
    return extract_data(
        client.request(
            "POST",
            "/api/v1/config/llm/models",
            payload={
                "providerId": provider_id,
                "modelId": model_id,
                "supportsToolUse": True,
                "supportsVision": False,
                "isEnabled": True,
                "endpointType": endpoint_type,
                "reasoningConfig": reasoning_config(default_reasoning_effort),
            },
            expected=(201,),
            label=label,
        )
    )


def seed_provider_catalog(
    client: ApiClient,
    *,
    auth_mode: str,
    provider_name: str,
    provider_type: str,
    provider_base_url: str,
    provider_api_key: str | None,
    oauth_profile_id: str | None,
    oauth_session: dict[str, Any] | None,
    model_id: str,
    model_endpoint_type: str,
    system_reasoning_effort: str,
    orchestrator_model_id: str,
    orchestrator_endpoint_type: str,
    orchestrator_reasoning_effort: str,
    specialist_model_id: str,
    specialist_endpoint_type: str,
    specialist_reasoning_effort: str,
    roles: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    normalized_auth_mode = auth_mode.strip().lower()
    if normalized_auth_mode == "oauth":
        if not oauth_profile_id:
            raise RuntimeError("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID is required when auth mode is oauth")
        if oauth_session is None:
            raise RuntimeError("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON is required when auth mode is oauth")
        require_refreshable_oauth_session(oauth_session)

        imported = extract_data(
            client.request(
                "POST",
                "/api/v1/config/oauth/import-session",
                payload={
                    "profileId": oauth_profile_id,
                    "providerName": provider_name,
                    **oauth_session,
                },
                expected=(200,),
                label="oauth.import-session",
            )
        )
        provider = {
            "id": imported["providerId"],
            "name": provider_name,
            "base_url": provider_base_url,
            "auth_mode": "oauth",
        }
        discover_result = extract_data(
            client.request(
                "POST",
                f"/api/v1/config/llm/providers/{provider['id']}/discover",
                payload={},
                expected=(200,),
                label="llm.providers.discover",
            )
        )
        available_models = discover_result.get("created", [])
        model = find_model(
            available_models,
            provider_id=provider["id"],
            model_id=model_id,
            endpoint_type=model_endpoint_type,
        )
        if model is None:
            raise RuntimeError(f"oauth provider did not expose required model {model_id}")
    elif normalized_auth_mode == "api_key":
        if not provider_api_key:
            raise RuntimeError("LIVE_TEST_PROVIDER_API_KEY is required when auth mode is api_key")

        provider = extract_data(
            client.request(
                "POST",
                "/api/v1/config/llm/providers",
                payload={
                    "name": provider_name,
                    "baseUrl": provider_base_url,
                    "apiKeySecretRef": provider_api_key,
                    "isEnabled": True,
                    "metadata": {"providerType": provider_type},
                },
                expected=(201,),
                label="llm.providers.create",
            )
        )
        model = create_model(
            client,
            provider_id=provider["id"],
            model_id=model_id,
            endpoint_type=model_endpoint_type,
            default_reasoning_effort=system_reasoning_effort,
            label="llm.models.create.system",
        )
        available_models = [model]
    else:
        raise RuntimeError(f"unsupported LIVE_TEST_PROVIDER_AUTH_MODE: {auth_mode}")

    client.request(
        "PUT",
        "/api/v1/config/llm/system-default",
        payload={
            "modelId": model["id"],
            "reasoningConfig": reasoning_assignment(system_reasoning_effort),
        },
        expected=(200,),
        label="llm.system-default.update",
    )

    orchestrator_model = ensure_orchestrator_assignment(
        client,
        provider_id=provider["id"],
        existing_models=available_models,
        orchestrator_model_id=orchestrator_model_id,
        orchestrator_endpoint_type=orchestrator_endpoint_type,
        orchestrator_reasoning_effort=orchestrator_reasoning_effort,
    )

    specialist_model = ensure_specialist_assignments(
        client,
        provider_id=provider["id"],
        existing_models=available_models,
        roles=roles,
        specialist_model_id=specialist_model_id,
        specialist_endpoint_type=specialist_endpoint_type,
        specialist_reasoning_effort=specialist_reasoning_effort,
    )
    return provider, model, orchestrator_model, specialist_model


def require_refreshable_oauth_session(oauth_session: dict[str, Any]) -> dict[str, Any]:
    credentials = oauth_session.get("credentials")
    if not isinstance(credentials, dict):
        raise RuntimeError("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON must include a credentials object")

    access_token = credentials.get("accessToken")
    if not isinstance(access_token, str) or access_token.strip() == "":
        raise RuntimeError("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON must include credentials.accessToken")

    refresh_token = credentials.get("refreshToken")
    if not isinstance(refresh_token, str) or refresh_token.strip() == "":
        raise RuntimeError("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON must include credentials.refreshToken")

    if credentials.get("needsReauth") is True:
        raise RuntimeError("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON requires reauthorization before live execution")

    return oauth_session


def build_workspace_create_payload(
    *,
    workspace_name: str,
    workspace_slug: str,
    workspace_description: str,
    workspace_config: dict[str, Any],
    repository_url: str,
    default_branch: str,
    git_user_name: str,
    git_user_email: str,
    git_token: str,
    host_workspace_path: str | None = None,
) -> dict[str, Any]:
    storage = resolve_workspace_storage(workspace_config)
    payload: dict[str, Any] = {
        "name": workspace_name,
        "slug": workspace_slug,
        "description": workspace_description,
    }
    if storage["type"] == "git_remote":
        payload["repository_url"] = repository_url
        payload["settings"] = {
            "default_branch": default_branch,
            "git_user_name": git_user_name,
            "git_user_email": git_user_email,
            "credentials": {"git_token": git_token},
        }
    elif storage["type"] == "host_directory":
        resolved_host_path = storage.get("host_path") or host_workspace_path
        if not isinstance(resolved_host_path, str) or resolved_host_path.strip() == "":
            raise RuntimeError("host directory path is required for host-directory workspaces")
        payload["settings"] = {
            "workspace_storage_type": "host_directory",
            "workspace_storage": {
                "host_path": resolved_host_path.strip(),
                "read_only": bool(storage.get("read_only", False)),
            },
        }
    return payload


def resolve_workspace_storage(workspace_config: dict[str, Any]) -> dict[str, Any]:
    storage = workspace_config.get("storage")
    if isinstance(storage, dict):
        storage_type = str(storage.get("type") or "").strip()
        if storage_type != "":
            normalized = {"type": storage_type, "read_only": bool(storage.get("read_only", False))}
            host_path = storage.get("host_path")
            if isinstance(host_path, str) and host_path.strip() != "":
                normalized["host_path"] = host_path.strip()
            return normalized
    return {
        "type": "git_remote" if workspace_config.get("repo", True) else "workspace_artifacts",
        "read_only": False,
    }


def seed_workspace_context(client: ApiClient, *, workspace_id: str, workspace_config: dict[str, Any]) -> None:
    memory = workspace_config.get("memory", {})
    if isinstance(memory, dict):
        for key, value in memory.items():
            client.request(
                "PATCH",
                f"/api/v1/workspaces/{workspace_id}/memory",
                payload={"key": key, "value": value},
                expected=(200,),
                label=f"workspaces.memory.patch:{key}",
            )

    spec = workspace_config.get("spec", {})
    if isinstance(spec, dict) and spec:
        client.request(
            "PUT",
            f"/api/v1/workspaces/{workspace_id}/spec",
            payload=spec,
            expected=(200,),
            label="workspaces.spec.put",
        )


def ensure_specialist_assignments(
    client: ApiClient,
    *,
    provider_id: str,
    existing_models: list[dict[str, Any]],
    roles: list[dict[str, Any]],
    specialist_model_id: str,
    specialist_endpoint_type: str,
    specialist_reasoning_effort: str,
) -> dict[str, Any]:
    specialist_model = find_model(
        existing_models,
        provider_id=provider_id,
        model_id=specialist_model_id,
        endpoint_type=specialist_endpoint_type,
    )
    if specialist_model is None:
        specialist_model = create_model(
            client,
            provider_id=provider_id,
            model_id=specialist_model_id,
            endpoint_type=specialist_endpoint_type,
            default_reasoning_effort=specialist_reasoning_effort,
            label="llm.models.create.specialist",
        )

    for role in roles:
        client.request(
            "PUT",
            f"/api/v1/config/llm/assignments/{role['name']}",
            payload={
                "primaryModelId": specialist_model["id"],
                "reasoningConfig": reasoning_assignment(specialist_reasoning_effort),
            },
            expected=(200,),
            label=f"llm.assignments.update:{role['name']}",
        )

    return specialist_model


def ensure_orchestrator_assignment(
    client: ApiClient,
    *,
    provider_id: str,
    existing_models: list[dict[str, Any]],
    orchestrator_model_id: str,
    orchestrator_endpoint_type: str,
    orchestrator_reasoning_effort: str,
) -> dict[str, Any]:
    orchestrator_model = find_model(
        existing_models,
        provider_id=provider_id,
        model_id=orchestrator_model_id,
        endpoint_type=orchestrator_endpoint_type,
    )
    if orchestrator_model is None:
        orchestrator_model = create_model(
            client,
            provider_id=provider_id,
            model_id=orchestrator_model_id,
            endpoint_type=orchestrator_endpoint_type,
            default_reasoning_effort=orchestrator_reasoning_effort,
            label="llm.models.create.orchestrator",
        )

    client.request(
        "PUT",
        "/api/v1/config/llm/assignments/orchestrator",
        payload={
            "primaryModelId": orchestrator_model["id"],
            "reasoningConfig": reasoning_assignment(orchestrator_reasoning_effort),
        },
        expected=(200,),
        label="llm.assignments.update:orchestrator",
    )
    return orchestrator_model


def ensure_orchestrator_capacity(
    client: ApiClient,
    worker_name: str,
    runtime_image: str,
    replicas: int,
) -> dict[str, Any]:
    workers = extract_data(client.request("GET", "/api/v1/fleet/workers", label="fleet.workers.list"))
    orchestrator = find_worker(workers, worker_name)
    patch_payload: dict[str, Any] = {}
    if orchestrator.get("runtime_image") != runtime_image:
        patch_payload["runtimeImage"] = runtime_image
    if int(orchestrator.get("replicas") or 0) != replicas:
        patch_payload["replicas"] = replicas
    if orchestrator.get("enabled") is not True:
        patch_payload["enabled"] = True
    if patch_payload:
        orchestrator = extract_data(
            client.request(
                "PATCH",
                f"/api/v1/fleet/workers/{orchestrator['id']}",
                payload=patch_payload,
                expected=(200,),
                label=f"fleet.workers.update:{worker_name}",
            )
        )
    return orchestrator


def restart_orchestrator(
    client: ApiClient,
    worker_name: str,
    runtime_image: str,
    replicas: int,
) -> dict[str, Any]:
    orchestrator = ensure_orchestrator_capacity(client, worker_name, runtime_image, replicas)
    client.request(
        "POST",
        f"/api/v1/fleet/workers/{orchestrator['id']}/restart",
        payload={},
        expected=(200,),
        label=f"fleet.workers.restart:{worker_name}",
    )

    deadline = time.time() + 120
    while time.time() < deadline:
        workers = extract_data(client.request("GET", "/api/v1/fleet/workers", label="fleet.workers.poll"))
        containers = extract_data(client.request("GET", "/api/v1/fleet/containers", label="fleet.containers.poll"))
        orchestrator = find_worker(workers, worker_name)
        matching_containers = [
            container
            for container in containers
            if container.get("name") == worker_name
            and "healthy" in str(container.get("status", "")).lower()
            and container.get("image") == runtime_image
        ]
        if (
            orchestrator.get("restart_requested") is False
            and len(matching_containers) >= replicas
        ):
            return {"worker": orchestrator, "containers": matching_containers}
        time.sleep(2)

    raise RuntimeError(f"orchestrator worker {worker_name} did not become healthy in time")


def main() -> None:
    base_url = env("PLATFORM_API_BASE_URL", required=True)
    trace_dir = env("LIVE_TEST_TRACE_DIR", required=True)
    admin_api_key = env("DEFAULT_ADMIN_API_KEY", required=True)
    scenario_file = env("LIVE_TEST_SCENARIO_FILE")
    scenario = load_scenario(scenario_file) if scenario_file else None
    workspace_config = {"repo": True} if scenario is None else scenario["workspace"]
    workspace_storage = resolve_workspace_storage(workspace_config)
    provider_auth_mode = env("LIVE_TEST_PROVIDER_AUTH_MODE", "oauth")
    provider_name = env("LIVE_TEST_PROVIDER_NAME", "OpenAI (Subscription)")
    provider_type = env("LIVE_TEST_PROVIDER_TYPE", "openai")
    provider_base_url = env("LIVE_TEST_PROVIDER_BASE_URL", "https://chatgpt.com/backend-api")
    provider_api_key = env("LIVE_TEST_PROVIDER_API_KEY") or None
    oauth_profile_id = env("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID") or None
    oauth_session_json = env("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON")
    oauth_session = json.loads(oauth_session_json) if oauth_session_json else None
    model_id = env("LIVE_TEST_MODEL_ID", "gpt-5.4")
    model_endpoint_type = env("LIVE_TEST_MODEL_ENDPOINT_TYPE", "responses")
    system_reasoning_effort = env("LIVE_TEST_SYSTEM_REASONING_EFFORT", "medium")
    orchestrator_model_id = env("LIVE_TEST_ORCHESTRATOR_MODEL_ID", "gpt-5.4")
    orchestrator_endpoint_type = env("LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE", model_endpoint_type)
    orchestrator_reasoning_effort = env("LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT", "low")
    specialist_model_id = env("LIVE_TEST_SPECIALIST_MODEL_ID", "gpt-5.4")
    specialist_endpoint_type = env("LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE", model_endpoint_type)
    specialist_reasoning_effort = env("LIVE_TEST_SPECIALIST_REASONING_EFFORT", "medium")
    workspace_name = env("LIVE_TEST_WORKSPACE_NAME", "SDLC Proof Workspace")
    workspace_slug = env("LIVE_TEST_WORKSPACE_SLUG", "sdlc-proof-workspace")
    repository_url = env("LIVE_TEST_REPOSITORY_URL")
    default_branch = env("LIVE_TEST_DEFAULT_BRANCH", "main")
    git_user_name = env("LIVE_TEST_GIT_USER_NAME")
    git_user_email = env("LIVE_TEST_GIT_USER_EMAIL")
    git_token = env("LIVE_TEST_GIT_TOKEN") or env(
        "LIVE_TEST_GITHUB_TOKEN",
        required=workspace_storage["type"] == "git_remote",
    )
    host_workspace_path = env("LIVE_TEST_HOST_WORKSPACE_PATH") or None
    worker_name = env("ORCHESTRATOR_WORKER_NAME", "orchestrator-primary")
    orchestrator_replicas = int(env("LIVE_TEST_ORCHESTRATOR_REPLICAS", "2"))
    runtime_image = env("RUNTIME_IMAGE", "agirunner-runtime:local")
    library_root = env("LIVE_TEST_LIBRARY_ROOT", required=True)
    library_profile = env("LIVE_TEST_PROFILE", "sdlc-baseline")
    if scenario is not None:
        library_profile = scenario["profile"]
    if workspace_storage["type"] == "git_remote":
        if repository_url == "":
            raise RuntimeError("LIVE_TEST_REPOSITORY_URL is required for git_remote scenarios")
        if git_user_name == "":
            raise RuntimeError("LIVE_TEST_GIT_USER_NAME is required for git_remote scenarios")
        if git_user_email == "":
            raise RuntimeError("LIVE_TEST_GIT_USER_EMAIL is required for git_remote scenarios")
    roles_fixture_path = env(
        "LIVE_TEST_ROLE_FIXTURE_FILE",
        str(Path(library_root) / library_profile / "roles.json"),
    )
    playbook_fixture_path = env(
        "LIVE_TEST_PLAYBOOK_FIXTURE_FILE",
        str(Path(library_root) / library_profile / "playbook.json"),
    )

    trace = TraceRecorder(trace_dir)
    public_client = ApiClient(base_url, trace)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token, lambda: login(public_client, admin_api_key))

    delete_models_and_providers(client)
    clear_assignments(client)
    delete_workspaces(client)
    specialist_capability_registry = sync_profile_capabilities(
        client,
        profile_dir=Path(roles_fixture_path).resolve().parent,
    )
    roles = sync_roles(
        client,
        roles_fixture_path,
        provider_type=provider_type,
        resolved_model_id=specialist_model_id,
        specialist_capability_registry=specialist_capability_registry,
    )

    provider, model, orchestrator_model, specialist_model = seed_provider_catalog(
        client,
        auth_mode=provider_auth_mode,
        provider_name=provider_name,
        provider_type=provider_type,
        provider_base_url=provider_base_url,
        provider_api_key=provider_api_key,
        oauth_profile_id=oauth_profile_id,
        oauth_session=oauth_session,
        model_id=model_id,
        model_endpoint_type=model_endpoint_type,
        system_reasoning_effort=system_reasoning_effort,
        orchestrator_model_id=orchestrator_model_id,
        orchestrator_endpoint_type=orchestrator_endpoint_type,
        orchestrator_reasoning_effort=orchestrator_reasoning_effort,
        roles=roles,
        specialist_model_id=specialist_model_id,
        specialist_endpoint_type=specialist_endpoint_type,
        specialist_reasoning_effort=specialist_reasoning_effort,
    )

    workspace = extract_data(
        client.request(
            "POST",
            "/api/v1/workspaces",
            payload=build_workspace_create_payload(
                workspace_name=workspace_name,
                workspace_slug=workspace_slug,
                workspace_description="Repeatable live-test workspace seeded by the shared assessment-matrix harness",
                workspace_config=workspace_config,
                repository_url=repository_url,
                default_branch=default_branch,
                git_user_name=git_user_name,
                git_user_email=git_user_email,
                git_token=git_token,
                host_workspace_path=host_workspace_path,
            ),
            expected=(201,),
            label="workspaces.create",
        )
    )
    if scenario is not None:
        seed_workspace_context(client, workspace_id=workspace["id"], workspace_config=scenario["workspace"])

    playbook = sync_playbook(client, playbook_fixture_path)
    orchestrator = restart_orchestrator(client, worker_name, runtime_image, orchestrator_replicas)

    print(
        json.dumps(
            {
                "workspace_id": workspace["id"],
                "workspace_slug": workspace["slug"],
                "provider_id": provider["id"],
                "provider_name": provider_name,
                "provider_type": provider_type,
                "provider_auth_mode": provider_auth_mode,
                "model_id": model["id"],
                "model_name": model_id,
                "system_reasoning": system_reasoning_effort,
                "orchestrator_model_id": orchestrator_model["id"],
                "orchestrator_model_name": orchestrator_model["model_id"],
                "orchestrator_reasoning": orchestrator_reasoning_effort,
                "specialist_model_id": specialist_model["id"],
                "specialist_model_name": specialist_model["model_id"],
                "specialist_reasoning": specialist_reasoning_effort,
                "role_names": [role["name"] for role in roles],
                "skills": specialist_capability_registry["skills"],
                "remote_mcp_servers": specialist_capability_registry["remote_mcp_servers"],
                "playbook_id": playbook["id"],
                "playbook_slug": playbook["slug"],
                "orchestrator_worker_id": orchestrator["worker"]["id"],
                "orchestrator_replica_count": len(orchestrator["containers"]),
                "runtime_image": runtime_image,
                "platform_api_base_url": base_url,
            }
        )
    )


if __name__ == "__main__":
    main()
