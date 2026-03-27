#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import seed_live_test_run  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], tuple[int, ...], str | None]] = []
        self.current_default_environment_id = "env-ubuntu"

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, object]:
        normalized_payload = payload or {}
        self.calls.append((method, path, normalized_payload, expected, label))

        if method == "POST" and path == "/api/v1/workspaces":
            return {
                "data": {
                    "id": "workspace-1",
                    "slug": normalized_payload["slug"],
                    "settings": normalized_payload.get("settings", {}),
                }
            }
        if method == "POST" and path.startswith("/api/v1/execution-environments/") and path.endswith("/set-default"):
            self.current_default_environment_id = path.split("/")[4]
            return {"data": {"id": self.current_default_environment_id, "is_default": True}}
        if method == "GET" and path == "/api/v1/execution-environments":
            return {
                "data": [
                    {
                        "id": "env-debian",
                        "is_default": self.current_default_environment_id == "env-debian",
                        "name": "Debian Base",
                    },
                    {
                        "id": "env-ubuntu",
                        "is_default": self.current_default_environment_id == "env-ubuntu",
                        "name": "Ubuntu LTS Base",
                    },
                ]
            }
        if method == "PATCH" and path.endswith("/memory"):
            return {"data": {"ok": True}}
        if method == "PUT" and path.endswith("/spec"):
            return {"data": normalized_payload}
        raise AssertionError(f"unexpected request: {method} {path}")


class SeedLiveTestRunTests(unittest.TestCase):
    def test_create_run_context_uses_shared_profile_registry_and_unique_workspace_identity(self) -> None:
        client = FakeClient()
        shared_context = {
            "provider_auth_mode": "oauth",
            "execution_environments": {
                "default_candidates": [
                    {
                        "id": "env-debian",
                        "name": "Debian Base",
                        "image": "debian:trixie-slim",
                        "verified_metadata": {"distro": "debian", "package_manager": "apt-get"},
                    },
                    {
                        "id": "env-ubuntu",
                        "name": "Ubuntu LTS Base",
                        "image": "ubuntu:24.04",
                        "verified_metadata": {"distro": "ubuntu", "package_manager": "apt-get"},
                    },
                ]
            },
            "profiles": {
                "sdlc-assessment-approve": {
                    "playbook_id": "playbook-123",
                    "playbook_slug": "live-test-sdlc-assessment-approve-v1",
                    "playbook_launch_inputs": [
                        {"slug": "goal", "title": "Goal", "required": True},
                        {"slug": "scenario_name", "title": "Scenario Name", "required": True},
                        {"slug": "assessment_contract", "title": "Assessment Contract", "required": True},
                    ],
                    "roles": [
                        {
                            "name": "default-image-implementation-engineer",
                            "execution_environment_id": "env-debian",
                            "use_default_execution_environment": False,
                            "skill_slugs": [],
                            "mcp_server_slugs": [],
                        }
                    ],
                }
            },
        }
        scenario = {
            "name": "sdlc-assessment-approve",
            "profile": "sdlc-assessment-approve",
            "workspace": {
                "repo": True,
                "storage": {"type": "git_remote", "read_only": False},
                "memory": {"workspace_kind": "git"},
                "spec": {"instructions": "Use the repo workspace."},
            },
        }

        context = seed_live_test_run.create_run_context(
            client,
            shared_context=shared_context,
            scenario=scenario,
            run_token="run-01",
            workspace_name_prefix="Live Test Workspace",
            workspace_description="Scenario workspace",
            repository_url="https://github.com/agirunner/agirunner-test-fixtures.git",
            default_branch="live-test/run-01",
            git_user_name="sirmarkz",
            git_user_email="250921129+sirmarkz@users.noreply.github.com",
            git_token="github-token",
            host_workspace_path=None,
        )

        self.assertEqual("workspace-1", context["workspace_id"])
        self.assertEqual("playbook-123", context["playbook_id"])
        self.assertEqual("oauth", context["provider_auth_mode"])
        self.assertEqual("run-01", context["run_token"])
        self.assertEqual("sdlc-assessment-approve-run-01", context["workspace_slug"])
        self.assertEqual(
            [
                {"slug": "goal", "title": "Goal", "required": True},
                {"slug": "scenario_name", "title": "Scenario Name", "required": True},
                {"slug": "assessment_contract", "title": "Assessment Contract", "required": True},
            ],
            context["playbook_launch_inputs"],
        )
        self.assertEqual("env-ubuntu", context["default_execution_environment"]["id"])
        self.assertEqual("env-ubuntu", context["tenant_default_execution_environment"]["id"])
        self.assertEqual("ubuntu", context["default_execution_environment"]["verified_metadata"]["distro"])
        self.assertEqual(
            [
                {
                    "name": "default-image-implementation-engineer",
                    "execution_environment_id": "env-debian",
                    "use_default_execution_environment": False,
                    "skill_slugs": [],
                    "mcp_server_slugs": [],
                }
            ],
            context["profile_roles"],
        )
        self.assertEqual([], context["profile_skills"])
        self.assertEqual([], context["profile_remote_mcp_servers"])

        create_call = client.calls[0]
        self.assertEqual(
            ("POST", "/api/v1/execution-environments/env-ubuntu/set-default"),
            client.calls[0][:2],
        )
        create_call = client.calls[2]
        self.assertEqual(("POST", "/api/v1/workspaces"), create_call[:2])
        self.assertEqual("sdlc-assessment-approve-run-01", create_call[2]["slug"])
        self.assertEqual(
            "live-test/run-01",
            create_call[2]["settings"]["default_branch"],
        )
        self.assertEqual(
            [
                ("POST", "/api/v1/execution-environments/env-ubuntu/set-default"),
                ("GET", "/api/v1/execution-environments"),
                ("POST", "/api/v1/workspaces"),
                ("PATCH", "/api/v1/workspaces/workspace-1/memory"),
                ("PUT", "/api/v1/workspaces/workspace-1/spec"),
            ],
            [(method, path) for method, path, _, _, _ in client.calls],
        )

    def test_create_run_context_supports_host_directory_workspaces(self) -> None:
        client = FakeClient()
        shared_context = {
            "provider_auth_mode": "oauth",
            "execution_environments": {
                "default_candidates": [
                    {
                        "id": "env-debian",
                        "name": "Debian Base",
                        "image": "debian:trixie-slim",
                        "verified_metadata": {"distro": "debian", "package_manager": "apt-get"},
                    }
                ]
            },
            "profiles": {
                "host-directory-assessment": {
                    "playbook_id": "playbook-host",
                    "playbook_slug": "live-test-host-directory-assessment-v1",
                    "playbook_launch_inputs": [
                        {"slug": "goal", "title": "Goal", "required": True},
                    ],
                    "roles": [
                        {
                            "name": "host-directory-writer",
                            "execution_environment_id": None,
                            "use_default_execution_environment": True,
                            "skill_slugs": [],
                            "mcp_server_slugs": [],
                        }
                    ],
                }
            },
        }
        scenario = {
            "name": "host-directory-content-assessment",
            "profile": "host-directory-assessment",
            "workspace": {
                "repo": False,
                "storage": {"type": "host_directory", "read_only": False},
                "memory": {},
                "spec": {},
            },
        }

        context = seed_live_test_run.create_run_context(
            client,
            shared_context=shared_context,
            scenario=scenario,
            run_token="run-02",
            workspace_name_prefix="Host Workspace",
            workspace_description="Host scenario workspace",
            repository_url="https://github.com/agirunner/agirunner-test-fixtures.git",
            default_branch="main",
            git_user_name="sirmarkz",
            git_user_email="250921129+sirmarkz@users.noreply.github.com",
            git_token="github-token",
            host_workspace_path="/tmp/live-tests/host-directory-content-assessment/run-02",
        )

        self.assertEqual("workspace-1", context["workspace_id"])
        self.assertEqual("env-debian", context["default_execution_environment"]["id"])
        self.assertEqual("env-debian", context["tenant_default_execution_environment"]["id"])
        self.assertEqual(
            [{"slug": "goal", "title": "Goal", "required": True}],
            context["playbook_launch_inputs"],
        )
        self.assertEqual([], context["profile_skills"])
        self.assertEqual([], context["profile_remote_mcp_servers"])
        create_call = client.calls[2]
        self.assertEqual(
            "/tmp/live-tests/host-directory-content-assessment/run-02",
            create_call[2]["settings"]["workspace_storage"]["host_path"],
        )


if __name__ == "__main__":
    unittest.main()
