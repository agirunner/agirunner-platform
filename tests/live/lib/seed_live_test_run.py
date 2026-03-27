#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from hashlib import sha256
from pathlib import Path
from typing import Any

from live_test_api import ApiClient, TraceRecorder, read_json
from scenario_config import load_scenario
from seed_live_test_environment import (
    build_workspace_create_payload,
    extract_data,
    list_execution_environments,
    login,
    seed_workspace_context,
)


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def build_workspace_slug(*, scenario_name: str, run_token: str) -> str:
    return f"{scenario_name}-{run_token}".replace("_", "-")


def resolve_profile_context(shared_context: dict[str, Any], *, profile_name: str) -> dict[str, Any]:
    profiles = shared_context.get("profiles")
    if not isinstance(profiles, dict):
        raise RuntimeError("shared context must contain a profiles registry")
    profile = profiles.get(profile_name)
    if not isinstance(profile, dict):
        raise RuntimeError(f"shared context does not include profile {profile_name}")
    playbook_id = profile.get("playbook_id")
    if not isinstance(playbook_id, str) or playbook_id.strip() == "":
        raise RuntimeError(f"shared context profile {profile_name} is missing playbook_id")
    return profile


def scenario_uses_git_remote_storage(scenario: dict[str, Any]) -> bool:
    workspace = scenario.get("workspace")
    if not isinstance(workspace, dict):
        return False
    storage = workspace.get("storage")
    if not isinstance(storage, dict):
        return False
    return str(storage.get("type") or "").strip() == "git_remote"


def resolve_default_execution_environment_candidates(shared_context: dict[str, Any]) -> list[dict[str, Any]]:
    execution_environments = shared_context.get("execution_environments")
    if not isinstance(execution_environments, dict):
        raise RuntimeError("shared context must contain execution_environments")
    candidates = execution_environments.get("default_candidates")
    if not isinstance(candidates, list) or not candidates:
        raise RuntimeError("shared context must contain at least one default execution environment candidate")
    normalized = [dict(item) for item in candidates if isinstance(item, dict)]
    if not normalized:
        raise RuntimeError("shared context execution environment candidates must be objects")
    return normalized


def select_default_execution_environment(
    shared_context: dict[str, Any],
    *,
    scenario_name: str,
    run_token: str,
) -> dict[str, Any]:
    candidates = resolve_default_execution_environment_candidates(shared_context)
    selection_key = f"{scenario_name}:{run_token}".encode("utf-8")
    index = int.from_bytes(sha256(selection_key).digest()[:8], "big") % len(candidates)
    return candidates[index]


def profile_uses_default_execution_environment(profile_context: dict[str, Any]) -> bool:
    roles = profile_context.get("roles")
    if not isinstance(roles, list):
        return False
    return any(
        isinstance(role, dict) and bool(role.get("use_default_execution_environment"))
        for role in roles
    )


def set_default_execution_environment(client: ApiClient, *, environment_id: str) -> None:
    client.request(
        "POST",
        f"/api/v1/execution-environments/{environment_id}/set-default",
        payload={},
        expected=(200,),
        label=f"execution-environments.set-default:{environment_id}",
    )


def resolve_tenant_default_execution_environment(client: ApiClient) -> dict[str, Any]:
    environments = list_execution_environments(client)
    current_default = next(
        (environment for environment in environments if bool(environment.get("is_default"))),
        None,
    )
    if not isinstance(current_default, dict):
        raise RuntimeError("execution environments list does not include a current tenant default")
    return current_default


def create_run_context(
    client: ApiClient,
    *,
    shared_context: dict[str, Any],
    scenario: dict[str, Any],
    run_token: str,
    workspace_name_prefix: str,
    workspace_description: str,
    repository_url: str,
    default_branch: str,
    git_user_name: str,
    git_user_email: str,
    git_token: str,
    host_workspace_path: str | None,
) -> dict[str, Any]:
    profile_context = resolve_profile_context(shared_context, profile_name=scenario["profile"])
    default_execution_environment: dict[str, Any] | None = None
    tenant_default_execution_environment: dict[str, Any] | None = None
    if profile_uses_default_execution_environment(profile_context):
        default_execution_environment = select_default_execution_environment(
            shared_context,
            scenario_name=scenario["name"],
            run_token=run_token,
        )
        default_execution_environment_id = str(default_execution_environment.get("id") or "").strip()
        if default_execution_environment_id == "":
            raise RuntimeError("selected default execution environment is missing an id")
        set_default_execution_environment(client, environment_id=default_execution_environment_id)
        tenant_default_execution_environment = resolve_tenant_default_execution_environment(client)
        tenant_default_execution_environment_id = str(tenant_default_execution_environment.get("id") or "").strip()
        if tenant_default_execution_environment_id != default_execution_environment_id:
            raise RuntimeError(
                "selected default execution environment was not persisted as the current tenant default"
            )
    workspace_slug = build_workspace_slug(scenario_name=scenario["name"], run_token=run_token)
    workspace_name = f"{workspace_name_prefix} {run_token}"

    workspace = extract_data(
        client.request(
            "POST",
            "/api/v1/workspaces",
            payload=build_workspace_create_payload(
                workspace_name=workspace_name,
                workspace_slug=workspace_slug,
                workspace_description=workspace_description,
                workspace_config=scenario["workspace"],
                repository_url=repository_url,
                default_branch=default_branch,
                git_user_name=git_user_name,
                git_user_email=git_user_email,
                git_token=git_token,
                host_workspace_path=host_workspace_path,
            ),
            expected=(201,),
            label="workspaces.create.run",
        )
    )
    seed_workspace_context(client, workspace_id=workspace["id"], workspace_config=scenario["workspace"])

    return {
        "workspace_id": workspace["id"],
        "workspace_slug": workspace["slug"],
        "playbook_id": profile_context["playbook_id"],
        "playbook_slug": profile_context.get("playbook_slug"),
        "playbook_launch_inputs": profile_context.get("playbook_launch_inputs", []),
        "profile_skills": profile_context.get("skills", []),
        "profile_remote_mcp_servers": profile_context.get("remote_mcp_servers", []),
        "provider_auth_mode": shared_context.get("provider_auth_mode"),
        "run_token": run_token,
        "scenario_name": scenario["name"],
        "profile": scenario["profile"],
        "profile_roles": profile_context.get("roles", []),
        "default_execution_environment": default_execution_environment,
        "tenant_default_execution_environment": tenant_default_execution_environment,
    }


def emit_run_context(context: dict[str, Any]) -> None:
    serialized = json.dumps(context)
    output_path = env("LIVE_TEST_RUN_CONTEXT_FILE", "")
    if output_path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(serialized, encoding="utf-8")
        return
    print(serialized)


def main() -> None:
    base_url = env("PLATFORM_API_BASE_URL", required=True)
    trace_dir = env("LIVE_TEST_SCENARIO_TRACE_DIR", required=True)
    admin_api_key = env("DEFAULT_ADMIN_API_KEY", required=True)
    scenario_file = env("LIVE_TEST_SCENARIO_FILE", required=True)
    shared_context_file = env("LIVE_TEST_SHARED_CONTEXT_FILE", required=True)
    run_token = env("LIVE_TEST_RUN_TOKEN", required=True)
    git_token = env("LIVE_TEST_GIT_TOKEN") or env("LIVE_TEST_GITHUB_TOKEN")
    host_workspace_path = env("LIVE_TEST_HOST_WORKSPACE_PATH") or None
    workspace_name_prefix = env("LIVE_TEST_WORKSPACE_NAME_PREFIX", "Live Test Workspace")
    workspace_description = env(
        "LIVE_TEST_WORKSPACE_DESCRIPTION",
        "Repeatable live-test workspace seeded by tests/live harness",
    )

    scenario = load_scenario(scenario_file)
    uses_git_remote_storage = scenario_uses_git_remote_storage(scenario)
    shared_context = read_json(shared_context_file)
    repository_url = env("LIVE_TEST_REPOSITORY_URL")
    default_branch = env("LIVE_TEST_DEFAULT_BRANCH", "main")
    git_user_name = env("LIVE_TEST_GIT_USER_NAME")
    git_user_email = env("LIVE_TEST_GIT_USER_EMAIL")
    if uses_git_remote_storage:
        if repository_url == "":
            raise RuntimeError("LIVE_TEST_REPOSITORY_URL is required for git_remote scenarios")
        if git_user_name == "":
            raise RuntimeError("LIVE_TEST_GIT_USER_NAME is required for git_remote scenarios")
        if git_user_email == "":
            raise RuntimeError("LIVE_TEST_GIT_USER_EMAIL is required for git_remote scenarios")
    trace = TraceRecorder(trace_dir)
    public_client = ApiClient(base_url, trace)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token, lambda: login(public_client, admin_api_key))

    context = create_run_context(
        client,
        shared_context=shared_context,
        scenario=scenario,
        run_token=run_token,
        workspace_name_prefix=workspace_name_prefix,
        workspace_description=workspace_description,
        repository_url=repository_url,
        default_branch=default_branch,
        git_user_name=git_user_name,
        git_user_email=git_user_email,
        git_token=git_token,
        host_workspace_path=host_workspace_path,
    )
    emit_run_context(context)


if __name__ == "__main__":
    main()
