#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from workspace_prep import build_workspace_create_input, copy_host_workspace_seed, prepare_git_remote_workspace


class WorkspacePrepTests(unittest.TestCase):
    def test_copy_host_workspace_seed_materializes_run_specific_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            seed_root = Path(tmpdir) / "seed"
            seed_root.mkdir()
            (seed_root / "README.md").write_text("seed", encoding="utf-8")
            target_root = Path(tmpdir) / "prepared"

            prepared = copy_host_workspace_seed(seed_root, target_root, run_id="docs-smoke")

            self.assertTrue((prepared / "README.md").is_file())
            self.assertEqual("seed", (prepared / "README.md").read_text(encoding="utf-8"))
            self.assertTrue(str(prepared).endswith("docs-smoke"))

    def test_build_workspace_create_input_for_host_directory_uses_prepared_path(self) -> None:
        run_spec = {
            "id": "technical-documentation-smoke",
            "playbook_slug": "technical-documentation",
            "variant": "smoke",
            "workspace_profile_record": {
                "storage_type": "host_directory",
                "seed_path": "fixtures/host-workspaces/docs-portal",
            },
        }

        payload = build_workspace_create_input(
            run_spec,
            prepared_host_path="/tmp/docs-portal-run",
        )

        self.assertEqual("technical-documentation-smoke-workspace", payload["slug"])
        self.assertEqual("host_directory", payload["settings"]["workspace_storage_type"])
        self.assertEqual("/tmp/docs-portal-run", payload["settings"]["workspace_storage"]["host_path"])

    def test_build_workspace_create_input_for_git_remote_uses_live_env_git_settings(self) -> None:
        run_spec = {
            "id": "bug-fix-smoke",
            "playbook_slug": "bug-fix",
            "variant": "smoke",
            "workspace_profile_record": {
                "storage_type": "git_remote",
                "seed_path": "fixtures/host-workspaces/product-app-repo",
            },
        }

        with patch.dict(
            "os.environ",
            {
                "LIVE_TEST_REPOSITORY_URL": "https://example.com/test-fixtures.git",
                "LIVE_TEST_DEFAULT_BRANCH": "main",
                "LIVE_TEST_GIT_USER_NAME": "Agirunner Bot",
                "LIVE_TEST_GIT_USER_EMAIL": "bot@example.com",
                "LIVE_TEST_GIT_TOKEN": "token-123",
            },
            clear=False,
        ):
            payload = build_workspace_create_input(run_spec)

        self.assertEqual("https://example.com/test-fixtures.git", payload["repository_url"])
        self.assertEqual("main", payload["settings"]["default_branch"])
        self.assertEqual("token-123", payload["settings"]["credentials"]["git_token"])

    def test_build_workspace_create_input_for_git_remote_strips_credentials_from_repository_url(self) -> None:
        run_spec = {
            "id": "bug-fix-smoke",
            "playbook_slug": "bug-fix",
            "variant": "smoke",
            "workspace_profile_record": {
                "storage_type": "git_remote",
                "seed_path": "fixtures/host-workspaces/product-app-repo",
            },
        }

        with patch.dict(
            "os.environ",
            {
                "LIVE_TEST_REPOSITORY_URL": "https://x-access-token:secret-token@github.com/agirunner/agirunner-test-fixtures.git",
                "LIVE_TEST_DEFAULT_BRANCH": "main",
                "LIVE_TEST_GIT_USER_NAME": "Agirunner Bot",
                "LIVE_TEST_GIT_USER_EMAIL": "bot@example.com",
                "LIVE_TEST_GIT_TOKEN": "token-123",
            },
            clear=False,
        ):
            payload = build_workspace_create_input(run_spec)

        self.assertEqual(
            "https://github.com/agirunner/agirunner-test-fixtures.git",
            payload["repository_url"],
        )
        self.assertEqual("token-123", payload["settings"]["credentials"]["git_token"])

    def test_prepare_git_remote_workspace_preserves_git_metadata_while_copying_seed(self) -> None:
        run_spec = {
            "id": "bug-fix-smoke",
            "workspace_profile_record": {
                "storage_type": "git_remote",
                "seed_path": "fixtures/host-workspaces/product-app-repo",
            },
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            fixtures_root = Path(tmpdir) / "fixtures"
            fixtures_root.mkdir()
            seed_root = SUITE_ROOT / "fixtures" / "host-workspaces" / "product-app-repo"
            created_commands: list[list[str]] = []

            def fake_run_command(args: list[str], **_: object):
                created_commands.append(args)
                if args[:2] == ["git", "clone"]:
                    working_root = Path(args[3])
                    working_root.mkdir(parents=True, exist_ok=True)
                    (working_root / ".git").mkdir()
                return type("Completed", (), {"stdout": " M changed\n" if "status" in args else "", "returncode": 0})()

            with patch("workspace_prep.run_command", side_effect=fake_run_command):
                with patch.dict(
                    "os.environ",
                    {
                        "FIXTURES_REPO_PATH": str(fixtures_root),
                        "LIVE_TEST_GIT_USER_NAME": "Agirunner Bot",
                        "LIVE_TEST_GIT_USER_EMAIL": "bot@example.com",
                        "LIVE_TEST_REPOSITORY_URL": "https://example.com/test-fixtures.git",
                    },
                    clear=False,
                ):
                    prepared = prepare_git_remote_workspace(
                        run_spec,
                        output_root=Path(tmpdir) / "prepared",
                    )

            working_root = Path(prepared["working_root"])
            self.assertTrue((working_root / ".git").is_dir())
            self.assertTrue((working_root / "README.md").is_file())
            self.assertTrue(any(args[:3] == ["git", "-C", str(working_root)] for args in created_commands))


if __name__ == "__main__":
    unittest.main()
