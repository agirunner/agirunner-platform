from seed_live_test_environment_chunk02 import *

from seed_live_test_environment_chunk02 import *

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
        normalized_oauth_session = require_refreshable_oauth_session(oauth_session)

        imported = extract_data(
            client.request(
                "POST",
                "/api/v1/config/oauth/import-session",
                payload={
                    "profileId": oauth_profile_id,
                    "providerName": provider_name,
                    **normalized_oauth_session,
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
            model = create_model(
                client,
                provider_id=provider["id"],
                model_id=model_id,
                endpoint_type=model_endpoint_type,
                default_reasoning_effort=system_reasoning_effort,
                label="llm.models.create.system",
            )
            available_models = [*available_models, model]
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


def _normalize_oauth_session_credentials(oauth_session: dict[str, Any]) -> dict[str, Any]:
    credentials = oauth_session.get("credentials")
    if isinstance(credentials, dict):
        return dict(credentials)

    access_token = oauth_session.get("access_token")
    refresh_token = oauth_session.get("refresh_token")
    if not isinstance(access_token, str) or access_token.strip() == "":
        return {}
    if not isinstance(refresh_token, str) or refresh_token.strip() == "":
        return {}

    normalized: dict[str, Any] = {
        "accessToken": access_token,
        "refreshToken": refresh_token,
    }
    if oauth_session.get("expires_at") is not None:
        normalized["expiresAt"] = oauth_session.get("expires_at")
    if oauth_session.get("account_id") is not None:
        normalized["accountId"] = oauth_session.get("account_id")
    if oauth_session.get("email") is not None:
        normalized["email"] = oauth_session.get("email")
    if oauth_session.get("authorized_at") is not None:
        normalized["authorizedAt"] = oauth_session.get("authorized_at")
    if oauth_session.get("authorized_by_user_id") is not None:
        normalized["authorizedByUserId"] = oauth_session.get("authorized_by_user_id")
    if oauth_session.get("needs_reauth") is not None:
        normalized["needsReauth"] = oauth_session.get("needs_reauth")
    return normalized


def require_refreshable_oauth_session(oauth_session: dict[str, Any]) -> dict[str, Any]:
    credentials = _normalize_oauth_session_credentials(oauth_session)
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

    return {"credentials": credentials}


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
        payload["repository_url"] = sanitize_repository_url_for_display(repository_url)
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


def sanitize_repository_url_for_display(repository_url: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    trimmed = repository_url.strip()
    if trimmed == "":
        return trimmed
    parts = urlsplit(trimmed)
    hostname = parts.hostname or ""
    if hostname == "":
        return trimmed
    netloc = hostname
    if parts.port is not None:
        netloc = f"{hostname}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


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



__all__ = [name for name in globals() if not name.startswith("__")]
