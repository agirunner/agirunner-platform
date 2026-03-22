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
            "profiles": {
                "sdlc-single-assessment": {
                    "playbook_id": "playbook-123",
                    "playbook_slug": "live-test-sdlc-single-assessment-v1",
                }
            },
        }
        scenario = {
            "name": "sdlc-assessment-approve",
            "profile": "sdlc-single-assessment",
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

        create_call = client.calls[0]
        self.assertEqual(("POST", "/api/v1/workspaces"), create_call[:2])
        self.assertEqual("sdlc-assessment-approve-run-01", create_call[2]["slug"])
        self.assertEqual(
            "live-test/run-01",
            create_call[2]["settings"]["default_branch"],
        )
        self.assertEqual(
            [
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
            "profiles": {
                "host-directory-assessment": {
                    "playbook_id": "playbook-host",
                    "playbook_slug": "live-test-host-directory-assessment-v1",
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
        create_call = client.calls[0]
        self.assertEqual(
            "/tmp/live-tests/host-directory-content-assessment/run-02",
            create_call[2]["settings"]["workspace_storage"]["host_path"],
        )


if __name__ == "__main__":
    unittest.main()
