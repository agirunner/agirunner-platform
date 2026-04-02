#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from common import (
    create_api_client,
    read_env,
    read_json_file,
    repo_root,
    results_root,
    run_command,
    suite_root,
    write_json_file,
)
from bootstrap_key import resolve_provider_model_defaults, resolve_provider_reasoning_defaults
from community_catalog_api import CommunityCatalogApi
from seed_live_test_environment import (
    clear_assignments,
    delete_models_and_providers,
    delete_workspaces,
    ensure_live_test_execution_environments,
    login,
    restart_orchestrator,
    seed_provider_catalog,
)


BOOTSTRAP_CONTEXT_PATH = Path("bootstrap/context.json")
PREPARE_SCRIPT = suite_root() / "scripts" / "prepare-community-playbooks-environment.sh"


def bootstrap_context_file() -> Path:
    return results_root() / BOOTSTRAP_CONTEXT_PATH


def validate_bootstrap_context(context: dict[str, Any]) -> dict[str, Any]:
    specialist_model_id = str(context.get("specialist_model_id") or "").strip()
    specialist_reasoning = str(context.get("specialist_reasoning") or "").strip()
    if not specialist_model_id:
        raise RuntimeError("community bootstrap context is missing specialist_model_id")
    if not specialist_reasoning:
        raise RuntimeError("community bootstrap context is missing specialist_reasoning")
    return context


def prepare_environment() -> dict[str, Any]:
    run_command(
        ["bash", str(PREPARE_SCRIPT)],
        cwd=repo_root(),
        capture_output=True,
        env={"LIVE_TEST_ENV_LOAD_MODE": "preserve_existing"},
    )
    context = read_json_file(bootstrap_context_file())
    if not isinstance(context, dict):
        raise RuntimeError("community bootstrap context must be a JSON object")
    return validate_bootstrap_context(context)


def clear_existing_catalog_state(api: CommunityCatalogApi) -> None:
    for playbook in api.list_local_playbooks():
        playbook_id = str(playbook.get("id") or "").strip()
        if playbook_id:
            api.delete_playbook_permanently(playbook_id)

    for role in api.list_roles():
        role_id = str(role.get("id") or "").strip()
        if role_id:
            api.delete_role(role_id)

    for skill in api.list_skills():
        skill_id = str(skill.get("id") or "").strip()
        if skill_id:
            api.delete_skill(skill_id)

    for server in api.list_remote_mcp_servers():
        server_id = str(server.get("id") or "").strip()
        if server_id:
            api.delete_remote_mcp_server(server_id)

    for profile in api.list_remote_mcp_oauth_profiles():
        profile_id = str(profile.get("id") or "").strip()
        if profile_id:
            api.delete_remote_mcp_oauth_profile(profile_id)


def seed_environment_context() -> dict[str, Any]:
    trace_dir = results_root() / "bootstrap" / "api-trace"
    admin_api_key = read_env("DEFAULT_ADMIN_API_KEY", required=True)
    provider_auth_mode = read_env("LIVE_TEST_PROVIDER_AUTH_MODE", "oauth")
    provider_name = read_env("LIVE_TEST_PROVIDER_NAME", "OpenAI (Subscription)")
    provider_type = read_env("LIVE_TEST_PROVIDER_TYPE", "openai")
    provider_model_defaults = resolve_provider_model_defaults(provider_type)
    provider_reasoning_defaults = resolve_provider_reasoning_defaults(provider_type)
    provider_base_url = read_env("LIVE_TEST_PROVIDER_BASE_URL", "https://chatgpt.com/backend-api")
    provider_api_key = read_env("LIVE_TEST_PROVIDER_API_KEY") or None
    oauth_profile_id = read_env("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID") or None
    oauth_session_json = read_env("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON")
    oauth_session = json.loads(oauth_session_json) if oauth_session_json else None
    model_id = read_env("LIVE_TEST_MODEL_ID", provider_model_defaults["model_id"])
    model_endpoint_type = read_env("LIVE_TEST_MODEL_ENDPOINT_TYPE", provider_model_defaults["endpoint_type"])
    system_reasoning_effort = read_env(
        "LIVE_TEST_SYSTEM_REASONING_EFFORT",
        provider_reasoning_defaults["system_reasoning_effort"],
    )
    orchestrator_model_id = read_env("LIVE_TEST_ORCHESTRATOR_MODEL_ID", model_id)
    orchestrator_endpoint_type = read_env(
        "LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE",
        model_endpoint_type,
    )
    orchestrator_reasoning_effort = read_env(
        "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT",
        provider_reasoning_defaults["orchestrator_reasoning_effort"],
    )
    specialist_model_id = read_env("LIVE_TEST_SPECIALIST_MODEL_ID", model_id)
    specialist_endpoint_type = read_env(
        "LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE",
        model_endpoint_type,
    )
    specialist_reasoning_effort = read_env(
        "LIVE_TEST_SPECIALIST_REASONING_EFFORT",
        provider_reasoning_defaults["specialist_reasoning_effort"],
    )
    worker_name = read_env("ORCHESTRATOR_WORKER_NAME", "orchestrator-primary")
    orchestrator_replicas = int(read_env("LIVE_TEST_ORCHESTRATOR_REPLICAS", "2"))
    runtime_image = read_env("RUNTIME_IMAGE", "agirunner-runtime:local")
    execution_environment_selection_seed = read_env(
        "LIVE_TEST_EXECUTION_ENVIRONMENT_SELECTION_SEED",
        "community-playbooks-bootstrap",
    )

    public_client = create_api_client(trace_dir=trace_dir)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token, lambda: login(public_client, admin_api_key))
    api = CommunityCatalogApi(client)

    delete_workspaces(client)
    clear_assignments(client)
    delete_models_and_providers(client)
    clear_existing_catalog_state(api)

    execution_environments = ensure_live_test_execution_environments(client)
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
        specialist_model_id=specialist_model_id,
        specialist_endpoint_type=specialist_endpoint_type,
        specialist_reasoning_effort=specialist_reasoning_effort,
        roles=[],
    )
    orchestrator = restart_orchestrator(client, worker_name, runtime_image, orchestrator_replicas)

    context = {
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
        "execution_environments": execution_environments,
        "execution_environment_selection_seed": execution_environment_selection_seed,
        "orchestrator_worker_id": orchestrator["worker"]["id"],
        "orchestrator_replica_count": len(orchestrator["containers"]),
    }
    write_json_file(bootstrap_context_file(), context)
    return context


def main() -> None:
    print(json.dumps(seed_environment_context(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
