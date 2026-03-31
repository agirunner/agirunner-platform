from seed_live_test_environment_chunk01 import *

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



__all__ = [name for name in globals() if not name.startswith("__")]
