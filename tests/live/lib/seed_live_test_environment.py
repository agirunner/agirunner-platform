#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from live_test_api import ApiClient, TraceRecorder, read_json


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
            f"/api/v1/workspaces/{workspace['id']}",
            expected=(200,),
            label=f"workspaces.delete:{workspace['id']}",
        )


def load_fixture(path: str) -> Any:
    fixture_path = Path(path)
    if not fixture_path.is_file():
        raise RuntimeError(f"fixture not found: {path}")
    return read_json(fixture_path)


def sync_roles(client: ApiClient, roles_fixture_path: str) -> list[dict[str, Any]]:
    existing_roles = extract_data(
        client.request("GET", "/api/v1/config/roles", expected=(200,), label="roles.list")
    )
    existing_by_name = {role["name"]: role for role in existing_roles}
    synced_roles: list[dict[str, Any]] = []

    for payload in load_fixture(roles_fixture_path):
        existing = existing_by_name.get(payload["name"])
        if existing is None:
            role = extract_data(
                client.request(
                    "POST",
                    "/api/v1/config/roles",
                    payload=payload,
                    expected=(201,),
                    label=f"roles.create:{payload['name']}",
                )
            )
        else:
            role = extract_data(
                client.request(
                    "PUT",
                    f"/api/v1/config/roles/{existing['id']}",
                    payload=payload,
                    expected=(200,),
                    label=f"roles.update:{payload['name']}",
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


def restart_orchestrator(client: ApiClient, worker_name: str, runtime_image: str) -> dict[str, Any]:
    workers = extract_data(client.request("GET", "/api/v1/fleet/workers", label="fleet.workers.list"))
    orchestrator = find_worker(workers, worker_name)
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
        if (
            orchestrator.get("restart_requested") is False
            and len(containers) == 1
            and containers[0].get("name") == worker_name
            and "healthy" in str(containers[0].get("status", "")).lower()
            and containers[0].get("image") == runtime_image
        ):
            return {"worker": orchestrator, "container": containers[0]}
        time.sleep(2)

    raise RuntimeError(f"orchestrator worker {worker_name} did not become healthy in time")


def main() -> None:
    base_url = env("PLATFORM_API_BASE_URL", required=True)
    trace_dir = env("LIVE_TEST_TRACE_DIR", required=True)
    admin_api_key = env("DEFAULT_ADMIN_API_KEY", required=True)
    provider_name = env("LIVE_TEST_PROVIDER_NAME", "OpenAI")
    provider_type = env("LIVE_TEST_PROVIDER_TYPE", "openai")
    provider_base_url = env("LIVE_TEST_PROVIDER_BASE_URL", "https://api.openai.com/v1")
    provider_api_key = env("LIVE_TEST_PROVIDER_API_KEY", required=True)
    model_id = env("LIVE_TEST_MODEL_ID", "gpt-5.4")
    model_endpoint_type = env("LIVE_TEST_MODEL_ENDPOINT_TYPE", "responses")
    system_reasoning_effort = env("LIVE_TEST_SYSTEM_REASONING_EFFORT", "low")
    workspace_name = env("LIVE_TEST_WORKSPACE_NAME", "SDLC Proof Workspace")
    workspace_slug = env("LIVE_TEST_WORKSPACE_SLUG", "sdlc-proof-workspace")
    repository_url = env("LIVE_TEST_REPOSITORY_URL", "https://github.com/agirunner/agirunner-test-fixtures.git")
    default_branch = env("LIVE_TEST_DEFAULT_BRANCH", "main")
    git_user_name = env("LIVE_TEST_GIT_USER_NAME", "sirmarkz")
    git_user_email = env("LIVE_TEST_GIT_USER_EMAIL", "250921129+sirmarkz@users.noreply.github.com")
    git_token = env("LIVE_TEST_GITHUB_TOKEN", required=True)
    worker_name = env("ORCHESTRATOR_WORKER_NAME", "orchestrator-primary")
    runtime_image = env("RUNTIME_IMAGE", "agirunner-runtime:local")
    library_root = env("LIVE_TEST_LIBRARY_ROOT", required=True)
    library_profile = env("LIVE_TEST_PROFILE", "sdlc-baseline")
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
    client = public_client.with_bearer_token(auth_token)

    delete_models_and_providers(client)
    clear_assignments(client)
    delete_workspaces(client)
    roles = sync_roles(client, roles_fixture_path)

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

    model = extract_data(
        client.request(
            "POST",
            "/api/v1/config/llm/models",
            payload={
                "providerId": provider["id"],
                "modelId": model_id,
                "supportsToolUse": True,
                "supportsVision": False,
                "isEnabled": True,
                "endpointType": model_endpoint_type,
                "reasoningConfig": {
                    "type": "effort",
                    "options": ["none", "low", "medium", "high", "xhigh"],
                    "default": system_reasoning_effort,
                },
            },
            expected=(201,),
            label="llm.models.create",
        )
    )

    client.request(
        "PUT",
        "/api/v1/config/llm/system-default",
        payload={
            "modelId": model["id"],
            "reasoningConfig": {"effort": system_reasoning_effort, "reasoning_effort": system_reasoning_effort},
        },
        expected=(200,),
        label="llm.system-default.update",
    )

    workspace = extract_data(
        client.request(
            "POST",
            "/api/v1/workspaces",
            payload={
                "name": workspace_name,
                "slug": workspace_slug,
                "description": "Repeatable live-test workspace seeded by tests/live/prepare-live-test-environment.sh",
                "repository_url": repository_url,
                "settings": {
                    "default_branch": default_branch,
                    "git_user_name": git_user_name,
                    "git_user_email": git_user_email,
                    "credentials": {"git_token": git_token},
                },
            },
            expected=(201,),
            label="workspaces.create",
        )
    )

    playbook = sync_playbook(client, playbook_fixture_path)
    orchestrator = restart_orchestrator(client, worker_name, runtime_image)

    print(
        json.dumps(
            {
                "workspace_id": workspace["id"],
                "workspace_slug": workspace["slug"],
                "provider_id": provider["id"],
                "provider_name": provider_name,
                "provider_type": provider_type,
                "model_id": model["id"],
                "model_name": model_id,
                "system_reasoning": system_reasoning_effort,
                "role_names": [role["name"] for role in roles],
                "playbook_id": playbook["id"],
                "playbook_slug": playbook["slug"],
                "orchestrator_worker_id": orchestrator["worker"]["id"],
                "runtime_image": runtime_image,
                "platform_api_base_url": base_url,
            }
        )
    )


if __name__ == "__main__":
    main()
