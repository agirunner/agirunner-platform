from seed_live_test_environment_chunk03a import *
from bootstrap_key import resolve_provider_model_defaults, resolve_provider_reasoning_defaults

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
    provider_model_defaults = resolve_provider_model_defaults(provider_type)
    provider_reasoning_defaults = resolve_provider_reasoning_defaults(provider_type)
    provider_base_url = env("LIVE_TEST_PROVIDER_BASE_URL", "https://chatgpt.com/backend-api")
    provider_api_key = env("LIVE_TEST_PROVIDER_API_KEY") or None
    oauth_profile_id = env("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID") or None
    oauth_session_json = env("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON")
    oauth_session = json.loads(oauth_session_json) if oauth_session_json else None
    model_id = env("LIVE_TEST_MODEL_ID", provider_model_defaults["model_id"])
    model_endpoint_type = env("LIVE_TEST_MODEL_ENDPOINT_TYPE", provider_model_defaults["endpoint_type"])
    system_reasoning_effort = env(
        "LIVE_TEST_SYSTEM_REASONING_EFFORT",
        provider_reasoning_defaults["system_reasoning_effort"],
    )
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

__all__ = [name for name in globals() if not name.startswith("__")]

__all__ = [name for name in globals() if not name.startswith("__")]
