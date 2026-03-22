#!/usr/bin/env python3
from __future__ import annotations

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
            }
            self.roles.append(created)
            return {"data": created}

        if method == "PUT" and path.startswith("/api/v1/config/roles/"):
            role_id = path.rsplit("/", 1)[-1]
            updated = {
                "id": role_id,
                "name": payload["name"],
                "allowed_tools": payload.get("allowedTools", []),
            }
            self.roles = [role for role in self.roles if role.get("id") != role_id]
            self.roles.append(updated)
            return {"data": updated}

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
                (profile_dir / "playbook.json").write_text("{}", encoding="utf-8")

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
                    "role_names": ["profile-a-role"],
                },
                "profile-b": {
                    "playbook_id": "playbook-profile-b",
                    "playbook_slug": "slug-profile-b",
                    "role_names": ["profile-b-role"],
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

        provider, model, specialist_model = seed_live_test_environment.seed_provider_catalog(
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
            specialist_model_id="gpt-5.4-mini",
            specialist_endpoint_type="responses",
            specialist_reasoning_effort="medium",
            roles=roles,
        )

        self.assertEqual("provider-oauth", provider["id"])
        self.assertEqual("model-gpt-5.4", model["id"])
        self.assertEqual("model-gpt-5.4-mini", specialist_model["id"])
        self.assertEqual(
            [
                ("POST", "/api/v1/config/oauth/import-session"),
                ("POST", "/api/v1/config/llm/providers/provider-oauth/discover"),
                ("PUT", "/api/v1/config/llm/system-default"),
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
            {"primaryModelId": "model-gpt-5.4-mini", "reasoningConfig": {"effort": "medium", "reasoning_effort": "medium"}},
            client.calls[3][2],
        )


if __name__ == "__main__":
    unittest.main()
