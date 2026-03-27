#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import seed_live_test_environment  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], tuple[int, ...], str | None]] = []
        self.models: list[dict[str, object]] = []
        self.roles: list[dict[str, object]] = []
        self.execution_environments: list[dict[str, object]] = [
            {
                "id": "env-debian",
                "name": "Debian Base",
                "slug": "debian-base",
                "source_kind": "catalog",
                "catalog_key": "debian-base",
                "catalog_version": 1,
                "image": "debian:trixie-slim",
                "is_claimable": True,
                "is_archived": False,
                "compatibility_status": "compatible",
                "verified_metadata": {"distro": "debian", "package_manager": "apt-get"},
                "tool_capabilities": {"verified_baseline_commands": ["sh", "grep"]},
            },
            {
                "id": "env-ubuntu",
                "name": "Ubuntu LTS Base",
                "slug": "ubuntu-base",
                "source_kind": "catalog",
                "catalog_key": "ubuntu-base",
                "catalog_version": 1,
                "image": "ubuntu:24.04",
                "is_claimable": True,
                "is_archived": False,
                "compatibility_status": "compatible",
                "verified_metadata": {"distro": "ubuntu", "package_manager": "apt-get"},
                "tool_capabilities": {"verified_baseline_commands": ["sh", "grep"]},
            },
        ]
        self.oauth_models = [
            {
                "id": "model-gpt-5.4",
                "provider_id": "provider-oauth",
                "model_id": "gpt-5.4",
                "endpoint_type": "responses",
                "reasoning_config": {"type": "effort", "default": "low", "options": ["low", "medium"]},
            },
            {
                "id": "model-gpt-5.4-mini",
                "provider_id": "provider-oauth",
                "model_id": "gpt-5.4-mini",
                "endpoint_type": "responses",
                "reasoning_config": {
                    "type": "reasoning_effort",
                    "default": "medium",
                    "options": ["low", "medium", "high"],
                },
            },
            {
                "id": "model-gpt-5-codex-mini",
                "provider_id": "provider-oauth",
                "model_id": "gpt-5-codex-mini",
                "endpoint_type": "responses",
                "reasoning_config": {"type": "effort", "default": "medium", "options": ["low", "medium", "high"]},
            },
        ]

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, object]:
        payload = payload or {}
        self.calls.append((method, path, payload, expected, label))

        if method == "POST" and path == "/api/v1/config/llm/models":
            created = {
                "id": f"model-{payload['modelId']}",
                "provider_id": payload["providerId"],
                "model_id": payload["modelId"],
                "endpoint_type": payload["endpointType"],
                "reasoning_config": payload["reasoningConfig"],
            }
            self.models.append(created)
            return {"data": created}

        if method == "GET" and path == "/api/v1/config/roles":
            return {"data": self.roles}

        if method == "POST" and path == "/api/v1/config/roles":
            created = {
                "id": f"role-{len(self.roles) + 1}",
                "name": payload["name"],
                "allowed_tools": payload.get("allowedTools", []),
                "execution_environment_id": payload.get("executionEnvironmentId"),
            }
            self.roles.append(created)
            return {"data": created}

        if method == "PUT" and path.startswith("/api/v1/config/roles/"):
            role_id = path.rsplit("/", 1)[-1]
            updated = {
                "id": role_id,
                "name": payload["name"],
                "allowed_tools": payload.get("allowedTools", []),
                "execution_environment_id": payload.get("executionEnvironmentId"),
            }
            self.roles = [role for role in self.roles if role.get("id") != role_id]
            self.roles.append(updated)
            return {"data": updated}

        if method == "GET" and path == "/api/v1/execution-environments":
            return {"data": self.execution_environments}

        if method == "POST" and path == "/api/v1/execution-environments":
            created = {
                "id": f"env-{payload['name'].lower().replace(' ', '-')}",
                "slug": payload["name"].lower().replace(" ", "-"),
                "name": payload["name"],
                "source_kind": "custom",
                "catalog_key": None,
                "catalog_version": None,
                "image": payload["image"],
                "cpu": payload["cpu"],
                "memory": payload["memory"],
                "pull_policy": payload["pullPolicy"],
                "bootstrap_commands": payload.get("bootstrapCommands", []),
                "bootstrap_required_domains": payload.get("bootstrapRequiredDomains", []),
                "compatibility_status": "unknown",
                "compatibility_errors": [],
                "is_claimable": False,
                "is_archived": False,
                "verified_metadata": {},
                "tool_capabilities": {},
            }
            self.execution_environments.append(created)
            return {"data": created}

        if method == "POST" and path.startswith("/api/v1/execution-environments/") and path.endswith("/verify"):
            environment_id = path.split("/")[4]
            updated: dict[str, object] | None = None
            for environment in self.execution_environments:
                if environment.get("id") != environment_id:
                    continue
                environment["compatibility_status"] = "compatible"
                environment["is_claimable"] = True
                environment["verified_metadata"] = {"distro": "ubuntu", "package_manager": "apt-get"}
                environment["tool_capabilities"] = {"verified_baseline_commands": ["sh", "grep", "find"]}
                updated = environment
                break
            if updated is None:
                raise AssertionError(f"missing execution environment for verify: {environment_id}")
            return {"data": updated}

        if method == "GET" and path.startswith("/api/v1/execution-environments/"):
            environment_id = path.rsplit("/", 1)[-1]
            for environment in self.execution_environments:
                if environment.get("id") == environment_id:
                    return {"data": environment}
            raise AssertionError(f"missing execution environment: {environment_id}")

        if method == "POST" and path == "/api/v1/config/oauth/import-session":
            return {"data": {"providerId": "provider-oauth", "email": "operator@example.com"}}

        if method == "POST" and path == "/api/v1/config/llm/providers/provider-oauth/discover":
            return {"data": {"discovered": [], "created": self.oauth_models}}

        if method == "PUT" and path == "/api/v1/config/llm/system-default":
            return {"data": payload}

        if method == "PUT" and path.startswith("/api/v1/config/llm/assignments/"):
            role_name = path.rsplit("/", 1)[-1]
            return {
                "data": {
                    "role_name": role_name,
                    "primary_model_id": payload["primaryModelId"],
                    "reasoning_config": payload["reasoningConfig"],
                }
            }

        if method == "PATCH" and path.startswith("/api/v1/workspaces/") and path.endswith("/memory"):
            return {"data": {"ok": True}}

        if method == "PUT" and path.startswith("/api/v1/workspaces/") and path.endswith("/spec"):
            return {"data": payload}

        raise AssertionError(f"unexpected request: {method} {path}")


class SeedLiveTestEnvironmentTests(unittest.TestCase):
    def test_sync_library_profiles_registers_every_profile_and_returns_playbook_registry(self) -> None:
        client = FakeClient()
        with tempfile.TemporaryDirectory() as tmpdir:
            library_root = Path(tmpdir)
            for profile_name in ("profile-a", "profile-b"):
                profile_dir = library_root / profile_name
                profile_dir.mkdir(parents=True)
                (profile_dir / "roles.json").write_text("[]", encoding="utf-8")
                (profile_dir / "playbook.json").write_text(
                    json.dumps(
                        {
                            "definition": {
                                "parameters": [
                                    {
                                        "slug": f"{profile_name}-goal",
                                        "title": f"{profile_name} Goal",
                                        "required": True,
                                    }
                                ]
                            }
                        }
                    ),
                    encoding="utf-8",
                )

            with (
                patch.object(
                    seed_live_test_environment,
                    "sync_roles",
                    side_effect=lambda *args, **kwargs: [
                        {"name": f"{Path(args[1]).parent.name}-role"}
                    ],
                ),
                patch.object(
                    seed_live_test_environment,
                    "sync_playbook",
                    side_effect=lambda *args, **kwargs: {
                        "id": f"playbook-{Path(args[1]).parent.name}",
                        "slug": f"slug-{Path(args[1]).parent.name}",
                    },
                ),
            ):
                registry = seed_live_test_environment.sync_library_profiles(
                    client,
                    library_root=str(library_root),
                    provider_type="openai",
                    resolved_model_id="gpt-5.4-mini",
                )

        self.assertEqual(
            {
                "profile-a": {
                    "playbook_id": "playbook-profile-a",
                    "playbook_slug": "slug-profile-a",
                    "playbook_launch_inputs": [
                        {
                            "slug": "profile-a-goal",
                            "title": "profile-a Goal",
                            "required": True,
                        }
                    ],
                    "role_names": ["profile-a-role"],
                    "skills": [],
                    "remote_mcp_servers": [],
                    "roles": [
                        {
                            "name": "profile-a-role",
                            "execution_environment_id": None,
                            "use_default_execution_environment": False,
                            "skill_slugs": [],
                            "mcp_server_slugs": [],
                        }
                    ],
                },
                "profile-b": {
                    "playbook_id": "playbook-profile-b",
                    "playbook_slug": "slug-profile-b",
                    "playbook_launch_inputs": [
                        {
                            "slug": "profile-b-goal",
                            "title": "profile-b Goal",
                            "required": True,
                        }
                    ],
                    "role_names": ["profile-b-role"],
                    "skills": [],
                    "remote_mcp_servers": [],
                    "roles": [
                        {
                            "name": "profile-b-role",
                            "execution_environment_id": None,
                            "use_default_execution_environment": False,
                            "skill_slugs": [],
                            "mcp_server_slugs": [],
                        }
                    ],
                },
            },
            registry,
        )

    def test_sync_roles_enables_native_search_for_supported_models(self) -> None:
        client = FakeClient()

        with patch.object(
            seed_live_test_environment,
            "load_fixture",
            return_value=[{"name": "live-test-researcher", "allowedTools": ["file_read", "web_fetch"]}],
        ):
            seed_live_test_environment.sync_roles(
                client,
                "ignored.json",
                provider_type="openai",
                resolved_model_id="gpt-5.4-mini",
            )

        create_call = next(call for call in client.calls if call[0] == "POST" and call[1] == "/api/v1/config/roles")
        self.assertEqual(
            ["file_read", "web_fetch", "native_search"],
            create_call[2]["allowedTools"],
        )

    def test_sync_roles_leaves_native_search_disabled_for_unsupported_models(self) -> None:
        client = FakeClient()

        with patch.object(
            seed_live_test_environment,
            "load_fixture",
            return_value=[{"name": "live-test-researcher", "allowedTools": ["file_read", "web_fetch"]}],
        ):
            seed_live_test_environment.sync_roles(
                client,
                "ignored.json",
                provider_type="openai",
                resolved_model_id="gpt-4o",
            )

        create_call = next(call for call in client.calls if call[0] == "POST" and call[1] == "/api/v1/config/roles")
        self.assertEqual(
            ["file_read", "web_fetch"],
            create_call[2]["allowedTools"],
        )

    def test_sync_roles_resolves_execution_environment_alias_to_execution_environment_id(self) -> None:
        client = FakeClient()

        with patch.object(
            seed_live_test_environment,
            "load_fixture",
            return_value=[
                {
                    "name": "build-engineer",
                    "allowedTools": ["shell_exec"],
                    "executionEnvironmentAlias": "ubuntu-base",
                }
            ],
        ):
            roles = seed_live_test_environment.sync_roles(
                client,
                "ignored.json",
                execution_environment_aliases={
                    "ubuntu-base": {
                        "id": "env-ubuntu",
                        "name": "Ubuntu LTS Base",
                    }
                },
            )

        create_call = next(call for call in client.calls if call[0] == "POST" and call[1] == "/api/v1/config/roles")
        self.assertEqual("env-ubuntu", create_call[2]["executionEnvironmentId"])
        self.assertNotIn("executionEnvironmentAlias", create_call[2])
        self.assertEqual("env-ubuntu", roles[0]["execution_environment_id"])

    def test_sync_roles_assigns_catalog_execution_environment_when_role_has_no_override(self) -> None:
        client = FakeClient()

        with patch.object(
            seed_live_test_environment,
            "load_fixture",
            return_value=[
                {
                    "name": "release-assessor",
                    "allowedTools": ["shell_exec"],
                }
            ],
        ):
            roles = seed_live_test_environment.sync_roles(
                client,
                "ignored.json",
                default_execution_environment_candidates=[
                    {"id": "env-debian", "name": "Debian Base"},
                    {"id": "env-ubuntu", "name": "Ubuntu LTS Base"},
                ],
            )

        create_call = next(call for call in client.calls if call[0] == "POST" and call[1] == "/api/v1/config/roles")
        self.assertEqual("env-debian", create_call[2]["executionEnvironmentId"])
        self.assertEqual("env-debian", roles[0]["execution_environment_id"])

    def test_sync_roles_uses_selection_seed_for_catalog_execution_environment_assignment(self) -> None:
        client = FakeClient()

        with patch.object(
            seed_live_test_environment,
            "load_fixture",
            return_value=[
                {
                    "name": "release-assessor",
                    "allowedTools": ["shell_exec"],
                }
            ],
        ):
            roles = seed_live_test_environment.sync_roles(
                client,
                "ignored.json",
                default_execution_environment_candidates=[
                    {"id": "env-debian", "name": "Debian Base"},
                    {"id": "env-ubuntu", "name": "Ubuntu LTS Base"},
                ],
                execution_environment_selection_seed="seed-b",
            )

        create_call = next(call for call in client.calls if call[0] == "POST" and call[1] == "/api/v1/config/roles")
        self.assertEqual("env-ubuntu", create_call[2]["executionEnvironmentId"])
        self.assertEqual("env-ubuntu", roles[0]["execution_environment_id"])

    def test_sync_roles_preserves_default_execution_environment_opt_in_without_explicit_assignment(self) -> None:
        client = FakeClient()

        with patch.object(
            seed_live_test_environment,
            "load_fixture",
            return_value=[
                {
                    "name": "default-image-engineer",
                    "allowedTools": ["shell_exec"],
                    "useDefaultExecutionEnvironment": True,
                }
            ],
        ):
            roles = seed_live_test_environment.sync_roles(
                client,
                "ignored.json",
                default_execution_environment_candidates=[
                    {"id": "env-debian", "name": "Debian Base"},
                ],
            )

        create_call = next(call for call in client.calls if call[0] == "POST" and call[1] == "/api/v1/config/roles")
        self.assertNotIn("executionEnvironmentId", create_call[2])
        self.assertNotIn("useDefaultExecutionEnvironment", create_call[2])
        self.assertIsNone(roles[0]["execution_environment_id"])

    def test_ensure_live_test_execution_environments_registers_claimable_catalog_defaults(self) -> None:
        client = FakeClient()

        registry = seed_live_test_environment.ensure_live_test_execution_environments(client)

        self.assertEqual(["env-debian", "env-ubuntu"], [item["id"] for item in registry["default_candidates"]])
        self.assertEqual("env-debian", registry["aliases"]["debian-base"]["id"])
        self.assertEqual("env-ubuntu", registry["aliases"]["ubuntu-base"]["id"])
        self.assertEqual(
            [
                ("GET", "/api/v1/execution-environments"),
            ],
            [(method, path) for method, path, _, _, _ in client.calls],
        )

    def test_ensure_specialist_assignments_creates_missing_model_and_assigns_all_roles(self) -> None:
        client = FakeClient()
        roles = [
            {"name": "live-test-product-manager"},
            {"name": "live-test-architect"},
            {"name": "live-test-developer"},
        ]

        specialist_model = seed_live_test_environment.ensure_specialist_assignments(
            client,
            provider_id="provider-1",
            existing_models=[
                {
                    "id": "model-gpt-5.4",
                    "provider_id": "provider-1",
                    "model_id": "gpt-5.4",
                    "endpoint_type": "responses",
                    "reasoning_config": {"type": "effort", "default": "low", "options": ["low", "medium"]},
                }
            ],
            roles=roles,
            specialist_model_id="gpt-5.4-mini",
            specialist_endpoint_type="responses",
            specialist_reasoning_effort="medium",
        )

        self.assertEqual("model-gpt-5.4-mini", specialist_model["id"])
        self.assertEqual(
            [
                ("POST", "/api/v1/config/llm/models"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-product-manager"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-architect"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-developer"),
            ],
            [(method, path) for method, path, _, _, _ in client.calls],
        )
        for _, path, payload, _, _ in client.calls[1:]:
            self.assertEqual("model-gpt-5.4-mini", payload["primaryModelId"])
            self.assertEqual({"effort": "medium", "reasoning_effort": "medium"}, payload["reasoningConfig"])
            self.assertIn(path.rsplit("/", 1)[-1], {role["name"] for role in roles})

    def test_ensure_specialist_assignments_reuses_existing_model_when_present(self) -> None:
        client = FakeClient()
        specialist_model = seed_live_test_environment.ensure_specialist_assignments(
            client,
            provider_id="provider-1",
            existing_models=[
                {
                    "id": "model-gpt-5.4-mini",
                    "provider_id": "provider-1",
                    "model_id": "gpt-5.4-mini",
                    "endpoint_type": "responses",
                    "reasoning_config": {"type": "effort", "default": "medium", "options": ["low", "medium"]},
                }
            ],
            roles=[{"name": "live-test-qa"}],
            specialist_model_id="gpt-5.4-mini",
            specialist_endpoint_type="responses",
            specialist_reasoning_effort="medium",
        )

        self.assertEqual("model-gpt-5.4-mini", specialist_model["id"])
        self.assertEqual(
            [("PUT", "/api/v1/config/llm/assignments/live-test-qa")],
            [(method, path) for method, path, _, _, _ in client.calls],
        )

    def test_build_workspace_create_payload_supports_headless_scenarios(self) -> None:
        payload = seed_live_test_environment.build_workspace_create_payload(
            workspace_name="Product Requirements Workspace",
            workspace_slug="product-requirements",
            workspace_description="Artifact-first workspace",
            workspace_config={"repo": False},
            repository_url="https://github.com/agirunner/agirunner-test-fixtures.git",
            default_branch="main",
            git_user_name="sirmarkz",
            git_user_email="250921129+sirmarkz@users.noreply.github.com",
            git_token="github-token",
        )

        self.assertEqual("Product Requirements Workspace", payload["name"])
        self.assertEqual("product-requirements", payload["slug"])
        self.assertNotIn("repository_url", payload)
        self.assertNotIn("settings", payload)

    def test_build_workspace_create_payload_supports_host_directory_workspaces(self) -> None:
        payload = seed_live_test_environment.build_workspace_create_payload(
            workspace_name="Host Directory Workspace",
            workspace_slug="host-directory",
            workspace_description="Host directory workspace",
            workspace_config={
                "repo": False,
                "storage": {
                    "type": "host_directory",
                    "host_path": "/tmp/live-tests/host-directory",
                    "read_only": True,
                },
            },
            repository_url="https://github.com/agirunner/agirunner-test-fixtures.git",
            default_branch="main",
            git_user_name="sirmarkz",
            git_user_email="250921129+sirmarkz@users.noreply.github.com",
            git_token="github-token",
        )

        self.assertEqual("Host Directory Workspace", payload["name"])
        self.assertNotIn("repository_url", payload)
        self.assertEqual(
            {
                "workspace_storage_type": "host_directory",
                "workspace_storage": {
                    "host_path": "/tmp/live-tests/host-directory",
                    "read_only": True,
                },
            },
            payload["settings"],
        )

    def test_build_workspace_create_payload_rejects_host_directory_without_path(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "host directory path is required"):
            seed_live_test_environment.build_workspace_create_payload(
                workspace_name="Host Directory Workspace",
                workspace_slug="host-directory",
                workspace_description="Host directory workspace",
                workspace_config={
                    "repo": False,
                    "storage": {
                        "type": "host_directory",
                    },
                },
                repository_url="https://github.com/agirunner/agirunner-test-fixtures.git",
                default_branch="main",
                git_user_name="sirmarkz",
                git_user_email="250921129+sirmarkz@users.noreply.github.com",
                git_token="github-token",
            )

    def test_seed_workspace_context_writes_memory_and_spec_through_workspace_routes(self) -> None:
        client = FakeClient()
        seed_live_test_environment.seed_workspace_context(
            client,
            workspace_id="workspace-1",
            workspace_config={
                "memory": {
                    "existing_context": "Enterprise admins manage budgets.",
                    "launch_note": "Write a testable PRD.",
                },
                "spec": {
                    "documents": {
                        "strategy": {
                            "source": "external",
                            "url": "https://example.test/roadmap",
                        }
                    }
                },
            },
        )

        self.assertEqual(
            [
                ("PATCH", "/api/v1/workspaces/workspace-1/memory"),
                ("PATCH", "/api/v1/workspaces/workspace-1/memory"),
                ("PUT", "/api/v1/workspaces/workspace-1/spec"),
            ],
            [(method, path) for method, path, _, _, _ in client.calls],
        )
        self.assertEqual(
            {"key": "existing_context", "value": "Enterprise admins manage budgets."},
            client.calls[0][2],
        )
        self.assertEqual(
            {"documents": {"strategy": {"source": "external", "url": "https://example.test/roadmap"}}},
            client.calls[2][2],
        )

    def test_seed_provider_catalog_imports_oauth_session_and_reuses_discovered_models(self) -> None:
        client = FakeClient()
        roles = [{"name": "live-test-developer"}, {"name": "live-test-reviewer"}]

        provider, model, orchestrator_model, specialist_model = seed_live_test_environment.seed_provider_catalog(
            client,
            auth_mode="oauth",
            provider_name="OpenAI (Subscription)",
            provider_type="openai",
            provider_base_url="https://chatgpt.com/backend-api",
            provider_api_key=None,
            oauth_profile_id="openai-codex",
            oauth_session={
                "credentials": {
                    "accessToken": "enc:v1:access",
                    "refreshToken": "enc:v1:refresh",
                    "authorizedAt": "2026-03-19T00:00:00.000Z",
                }
            },
            model_id="gpt-5.4",
            model_endpoint_type="responses",
            system_reasoning_effort="low",
            orchestrator_model_id="gpt-5.4",
            orchestrator_endpoint_type="responses",
            orchestrator_reasoning_effort="low",
            specialist_model_id="gpt-5.4-mini",
            specialist_endpoint_type="responses",
            specialist_reasoning_effort="medium",
            roles=roles,
        )

        self.assertEqual("provider-oauth", provider["id"])
        self.assertEqual("model-gpt-5.4", model["id"])
        self.assertEqual("model-gpt-5.4", orchestrator_model["id"])
        self.assertEqual("model-gpt-5.4-mini", specialist_model["id"])
        self.assertEqual(
            [
                ("POST", "/api/v1/config/oauth/import-session"),
                ("POST", "/api/v1/config/llm/providers/provider-oauth/discover"),
                ("PUT", "/api/v1/config/llm/system-default"),
                ("PUT", "/api/v1/config/llm/assignments/orchestrator"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-developer"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-reviewer"),
            ],
            [(method, path) for method, path, _, _, _ in client.calls],
        )
        self.assertEqual(
            {"modelId": "model-gpt-5.4", "reasoningConfig": {"effort": "low", "reasoning_effort": "low"}},
            client.calls[2][2],
        )
        self.assertEqual(
            {
                "primaryModelId": "model-gpt-5.4",
                "reasoningConfig": {"effort": "low", "reasoning_effort": "low"},
            },
            client.calls[3][2],
        )
        self.assertEqual(
            {"primaryModelId": "model-gpt-5.4-mini", "reasoningConfig": {"effort": "medium", "reasoning_effort": "medium"}},
            client.calls[4][2],
        )


if __name__ == "__main__":
    unittest.main()
