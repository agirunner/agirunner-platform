#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import bootstrap_key  # noqa: E402


class BootstrapKeyTests(unittest.TestCase):
    def test_provider_model_defaults_use_claude_sonnet_4_6_for_anthropic(self) -> None:
        defaults = bootstrap_key.resolve_provider_model_defaults("anthropic")

        self.assertEqual(defaults["model_id"], "claude-sonnet-4-6")
        self.assertEqual(defaults["endpoint_type"], "messages")

    def test_provider_reasoning_defaults_use_low_for_anthropic(self) -> None:
        defaults = bootstrap_key.resolve_provider_reasoning_defaults("anthropic")

        self.assertEqual(defaults["orchestrator_reasoning_effort"], "low")
        self.assertEqual(defaults["specialist_reasoning_effort"], "low")

    def test_shared_bootstrap_key_changes_when_env_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            live_root, repo_root, runtime_root = self.create_fixture_roots(Path(tmpdir))
            base_env = {
                "DEFAULT_ADMIN_API_KEY": "admin-a",
                "LIVE_TEST_PROVIDER_AUTH_MODE": "oauth",
                "LIVE_TEST_PROVIDER_NAME": "OpenAI (Subscription)",
                "LIVE_TEST_PROVIDER_TYPE": "openai",
            }

            first = bootstrap_key.compute_shared_bootstrap_key(
                live_root=live_root,
                repo_root=repo_root,
                runtime_repo_root=runtime_root,
                environ=base_env,
            )
            second = bootstrap_key.compute_shared_bootstrap_key(
                live_root=live_root,
                repo_root=repo_root,
                runtime_repo_root=runtime_root,
                environ={**base_env, "LIVE_TEST_PROVIDER_NAME": "Anthropic"},
            )

        self.assertNotEqual(first, second)

    def test_shared_bootstrap_key_changes_when_library_fixtures_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            live_root, repo_root, runtime_root = self.create_fixture_roots(Path(tmpdir))
            env = {"DEFAULT_ADMIN_API_KEY": "admin-a"}

            first = bootstrap_key.compute_shared_bootstrap_key(
                live_root=live_root,
                repo_root=repo_root,
                runtime_repo_root=runtime_root,
                environ=env,
            )

            playbook_file = live_root / "library" / "demo-profile" / "playbook.json"
            playbook_file.write_text(json.dumps({"name": "demo", "version": 2}), encoding="utf-8")

            second = bootstrap_key.compute_shared_bootstrap_key(
                live_root=live_root,
                repo_root=repo_root,
                runtime_repo_root=runtime_root,
                environ=env,
            )

        self.assertNotEqual(first, second)

    def test_context_has_key_reads_persisted_bootstrap_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            context_file = Path(tmpdir) / "context.json"
            context_file.write_text(
                json.dumps({"shared_bootstrap_key": "expected-key"}),
                encoding="utf-8",
            )

            self.assertTrue(bootstrap_key.context_has_key(context_file, "expected-key"))
            self.assertFalse(bootstrap_key.context_has_key(context_file, "different-key"))

    def test_shared_bootstrap_defaults_use_non_mini_models(self) -> None:
        self.assertEqual(bootstrap_key.SHARED_BOOTSTRAP_DEFAULTS["LIVE_TEST_MODEL_ID"], "gpt-5.4")
        self.assertEqual(
            bootstrap_key.SHARED_BOOTSTRAP_DEFAULTS["LIVE_TEST_SPECIALIST_MODEL_ID"],
            "gpt-5.4",
        )

    def create_fixture_roots(self, root: Path) -> tuple[Path, Path, Path]:
        live_root = root / "tests-live"
        repo_root = root / "platform"
        runtime_root = root / "runtime"

        (repo_root / "apps" / "platform-api").mkdir(parents=True)
        (repo_root / "packages").mkdir(parents=True)
        (repo_root / "services" / "container-manager").mkdir(parents=True)
        (runtime_root / "internal").mkdir(parents=True)
        (live_root / "fixtures" / "remote-mcp-fixture").mkdir(parents=True)
        (live_root / "lib").mkdir(parents=True)
        (live_root / "library" / "demo-profile").mkdir(parents=True)
        (live_root / "scripts").mkdir(parents=True)

        (repo_root / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
        (repo_root / "apps" / "platform-api" / "index.ts").write_text("export const api = 1;\n", encoding="utf-8")
        (repo_root / "packages" / "shared.ts").write_text("export const shared = true;\n", encoding="utf-8")
        (repo_root / "services" / "container-manager" / "main.go").write_text("package main\n", encoding="utf-8")
        (runtime_root / "go.mod").write_text("module example/runtime\n", encoding="utf-8")
        (runtime_root / "internal" / "app.go").write_text("package internal\n", encoding="utf-8")
        (live_root / "docker-compose.live-test.yml").write_text("services: {}\n", encoding="utf-8")
        (live_root / "fixtures" / "remote-mcp-fixture" / "app.py").write_text("print('fixture')\n", encoding="utf-8")
        (live_root / "lib" / "seed_live_test_shared_environment.py").write_text("print('seed')\n", encoding="utf-8")
        (live_root / "scripts" / "prepare-live-test-shared-environment.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
        (live_root / "library" / "demo-profile" / "playbook.json").write_text(
            json.dumps({"name": "demo", "version": 1}),
            encoding="utf-8",
        )

        return live_root, repo_root, runtime_root


if __name__ == "__main__":
    unittest.main()
