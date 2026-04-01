#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from typing import Any

from bootstrap_key import resolve_provider_model_defaults, resolve_provider_reasoning_defaults
from live_test_api import ApiClient, TraceRecorder
from seed_live_test_environment import (
    clear_assignments,
    delete_models_and_providers,
    delete_workspaces,
    ensure_live_test_execution_environments,
    login,
    restart_orchestrator,
    seed_provider_catalog,
    sync_library_profiles,
)


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def emit_context(context: dict[str, Any]) -> None:
    serialized = json.dumps(context)
    output_path = env("LIVE_TEST_SHARED_CONTEXT_FILE", "")
    if output_path:
        with open(output_path, "w", encoding="utf-8") as handle:
            handle.write(serialized)
        return
    print(serialized)


def main() -> None:
    base_url = env("PLATFORM_API_BASE_URL", required=True)
    trace_dir = env("LIVE_TEST_TRACE_DIR", required=True)
    admin_api_key = env("DEFAULT_ADMIN_API_KEY", required=True)
    provider_auth_mode = env("LIVE_TEST_PROVIDER_AUTH_MODE", "oauth")
    provider_name = env("LIVE_TEST_PROVIDER_NAME", "OpenAI (Subscription)")
    provider_type = env("LIVE_TEST_PROVIDER_TYPE", "openai")
    provider_model_defaults = resolve_provider_model_defaults(provider_type)
    provider_reasoning_defaults = resolve_provider_reasoning_defaults(provider_type)
    provider_base_url = env("LIVE_TEST_PROVIDER_BASE_URL", "https://chatgpt.com/backend-api")
    provider_api_key = env("LIVE_TEST_PROVIDER_API_KEY") or None
    oauth_profile_id = env("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID") or None
    oauth_session_json = env("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON")
    oauth_session = json.loads(oauth_session_json) if oauth_session_json else None
    model_id = env("LIVE_TEST_MODEL_ID", provider_model_defaults["model_id"])
    model_endpoint_type = env("LIVE_TEST_MODEL_ENDPOINT_TYPE", provider_model_defaults["endpoint_type"])
    system_reasoning_effort = env("LIVE_TEST_SYSTEM_REASONING_EFFORT", "medium")
    orchestrator_model_id = env("LIVE_TEST_ORCHESTRATOR_MODEL_ID", model_id)
    orchestrator_endpoint_type = env("LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE", model_endpoint_type)
    orchestrator_reasoning_effort = env(
        "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT",
        provider_reasoning_defaults["orchestrator_reasoning_effort"],
    )
    specialist_model_id = env("LIVE_TEST_SPECIALIST_MODEL_ID", model_id)
    specialist_endpoint_type = env("LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE", model_endpoint_type)
    specialist_reasoning_effort = env(
        "LIVE_TEST_SPECIALIST_REASONING_EFFORT",
        provider_reasoning_defaults["specialist_reasoning_effort"],
    )
    worker_name = env("ORCHESTRATOR_WORKER_NAME", "orchestrator-primary")
    orchestrator_replicas = int(env("LIVE_TEST_ORCHESTRATOR_REPLICAS", "2"))
    runtime_image = env("RUNTIME_IMAGE", "agirunner-runtime:local")
    library_root = env("LIVE_TEST_LIBRARY_ROOT", required=True)
    execution_environment_selection_seed = env("LIVE_TEST_EXECUTION_ENVIRONMENT_SELECTION_SEED") or None
    shared_bootstrap_key = env("LIVE_TEST_SHARED_BOOTSTRAP_KEY") or None

    trace = TraceRecorder(trace_dir)
    public_client = ApiClient(base_url, trace)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token, lambda: login(public_client, admin_api_key))

    delete_workspaces(client)
    clear_assignments(client)
    delete_models_and_providers(client)
    execution_environments = ensure_live_test_execution_environments(client)

    profiles = sync_library_profiles(
        client,
        library_root=library_root,
        provider_type=provider_type,
        resolved_model_id=specialist_model_id,
        execution_environment_aliases=execution_environments["aliases"],
        default_execution_environment_candidates=execution_environments["default_candidates"],
        execution_environment_selection_seed=execution_environment_selection_seed,
    )
    roles = [{"name": role_name} for profile in profiles.values() for role_name in profile["role_names"]]

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
        roles=roles,
    )
    orchestrator = restart_orchestrator(client, worker_name, runtime_image, orchestrator_replicas)

    emit_context(
        {
            "provider_auth_mode": provider_auth_mode,
            "provider_id": provider["id"],
            "provider_name": provider_name,
            "provider_type": provider_type,
            "model_id": model["id"],
            "model_name": model_id,
            "system_reasoning": system_reasoning_effort,
            "orchestrator_model_id": orchestrator_model["id"],
            "orchestrator_model_name": orchestrator_model["model_id"],
            "orchestrator_reasoning": orchestrator_reasoning_effort,
            "orchestrator_worker_id": orchestrator["worker"]["id"],
            "orchestrator_replica_count": len(orchestrator["containers"]),
            "specialist_model_id": specialist_model["id"],
            "specialist_model_name": specialist_model["model_id"],
            "specialist_reasoning": specialist_reasoning_effort,
            "execution_environments": execution_environments,
            "execution_environment_selection_seed": execution_environment_selection_seed,
            "shared_bootstrap_key": shared_bootstrap_key,
            "profiles": profiles,
        }
    )


if __name__ == "__main__":
    main()
