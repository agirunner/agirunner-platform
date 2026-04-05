#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import argparse
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
RUNNER = SUITE_ROOT / "run.sh"
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

import runner as community_runner


class RunnerContractTests(unittest.TestCase):
    def test_build_local_playbooks_by_slug_prefers_active_highest_version(self) -> None:
        indexed = community_runner.build_local_playbooks_by_slug(
            [
                {
                    "id": "pb-v1",
                    "slug": "research-analysis",
                    "version": 1,
                    "is_active": False,
                    "updated_at": "2026-04-04T23:57:30Z",
                },
                {
                    "id": "pb-v2",
                    "slug": "research-analysis",
                    "version": 2,
                    "is_active": True,
                    "updated_at": "2026-04-04T23:57:29Z",
                },
            ]
        )

        self.assertEqual("pb-v2", indexed["research-analysis"]["id"])

    def test_help_succeeds(self) -> None:
        completed = subprocess.run(
            ["bash", str(RUNNER), "--help"],
            cwd=SUITE_ROOT.parents[2],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertEqual(0, completed.returncode)
        self.assertIn("Usage:", completed.stdout)

    def test_unknown_batch_is_rejected(self) -> None:
        completed = subprocess.run(
            ["bash", str(RUNNER), "--batch", "bogus"],
            cwd=SUITE_ROOT.parents[2],
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(0, completed.returncode)
        self.assertIn("unsupported batch", completed.stderr)

    def test_wrapper_exports_required_default_environment_for_deterministic_run_invocation(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / "local.env"
            env_file.write_text("PLATFORM_API_PORT=18080\nDASHBOARD_PORT=13000\n", encoding="utf-8")
            capture_path = Path(tmpdir) / "capture.json"
            python_dir = Path(tmpdir) / "bin"
            python_dir.mkdir()
            fake_python = python_dir / "python3"
            real_python = sys.executable
            fake_python.write_text(
                "\n".join(
                    [
                        f"#!{real_python}",
                        "import json",
                        "import os",
                        "import sys",
                        f"capture_path = {str(capture_path)!r}",
                        "payload = {",
                        "  'args': sys.argv[1:],",
                        "  'platform_api_base_url': os.environ.get('PLATFORM_API_BASE_URL'),",
                        "  'dashboard_base_url': os.environ.get('DASHBOARD_BASE_URL'),",
                        "  'mcp_secret': os.environ.get('LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET'),",
                        "}",
                        "with open(capture_path, 'w', encoding='utf-8') as handle:",
                        "    json.dump(payload, handle)",
                        "raise SystemExit(0)",
                    ]
                ),
                encoding="utf-8",
            )
            fake_python.chmod(0o755)

            env = os.environ.copy()
            env["LIVE_TEST_ENV_FILE"] = str(env_file)
            env["PATH"] = f"{python_dir}:{env.get('PATH', '')}"

            completed = subprocess.run(
                ["bash", str(RUNNER), "--playbook", "bug-fix", "--variant", "smoke", "--manual-operator-actions"],
                cwd=SUITE_ROOT.parents[2],
                check=False,
                text=True,
                capture_output=True,
                env=env,
            )

            self.assertEqual(0, completed.returncode, completed.stderr)
            payload = json.loads(capture_path.read_text(encoding="utf-8"))
            self.assertTrue(payload["args"][0].endswith("/tests/community-playbooks/lib/runner.py"))
            self.assertEqual(
                ["--playbook", "bug-fix", "--variant", "smoke", "--manual-operator-actions"],
                payload["args"][1:],
            )
            self.assertEqual("http://127.0.0.1:18080", payload["platform_api_base_url"])
            self.assertEqual("http://127.0.0.1:13000", payload["dashboard_base_url"])
            self.assertEqual("live-test-parameterized-secret", payload["mcp_secret"])

    def test_execute_bootstrap_only_runs_prepare_environment(self) -> None:
        args = argparse.Namespace(
            bootstrap_only=True,
            import_only=False,
            batch=None,
            playbook=None,
            variant=None,
            provider=None,
            manual_operator_actions=False,
            failed_only=False,
        )
        with patch("runner.prepare_environment", return_value={"specialist_model_id": "model-1"}) as prepare_mock:
            payload = community_runner.execute(args)

        prepare_mock.assert_called_once_with()
        self.assertEqual({"specialist_model_id": "model-1"}, payload["bootstrap"])

    def test_execute_import_only_runs_import_flow(self) -> None:
        args = argparse.Namespace(
            bootstrap_only=False,
            import_only=True,
            batch=None,
            playbook=None,
            variant=None,
            provider=None,
            manual_operator_actions=False,
            failed_only=False,
        )
        with patch("runner.run_import_only", return_value={"catalog_playbook_count": 17}) as import_mock:
            payload = community_runner.execute(args)

        import_mock.assert_called_once_with()
        self.assertEqual({"catalog_playbook_count": 17}, payload["import"])

    def test_execute_default_run_reports_resolved_run_count(self) -> None:
        args = argparse.Namespace(
            bootstrap_only=False,
            import_only=False,
            batch=["smoke"],
            playbook="bug-fix",
            variant="smoke",
            provider=None,
            manual_operator_actions=True,
            failed_only=False,
        )

        with patch("runner.prepare_environment", return_value={"specialist_model_id": "model-1", "specialist_reasoning": "medium"}):
            fake_client = type(
                "FakeClient",
                (),
                {
                    "request": lambda self, method, path, payload=None, expected=(200,), label=None: {
                        "data": [{"id": "pb-1", "slug": "bug-fix"}]
                    }
                },
            )()
            fake_api = type("FakeApi", (), {"client": fake_client})()
            with patch("runner.create_catalog_api", return_value=fake_api):
                with patch("runner.import_full_catalog", return_value={"catalog_playbook_count": 17}):
                    with patch("runner.assign_specialist_model_to_roles", return_value=[]):
                        with patch("runner.configure_community_mcp_servers", return_value={"items": [], "by_slug": {}}):
                            with patch(
                                "runner.execute_runs",
                                return_value={
                                    "runs": [{"id": "bug-fix-smoke", "passed": True}],
                                    "passed": True,
                                    "passed_count": 1,
                                    "failed_count": 0,
                                },
                            ):
                                payload = community_runner.execute(args)

        self.assertEqual(1, payload["selection"]["resolved_run_count"])
        self.assertTrue(payload["selection"]["manual_operator_actions"])
        self.assertEqual(1, len(payload["runs"]))

    def test_execute_prefers_active_playbook_revision_when_duplicate_slugs_exist(self) -> None:
        args = argparse.Namespace(
            bootstrap_only=False,
            import_only=False,
            batch=["matrix"],
            playbook="research-analysis",
            variant="native-search",
            provider=None,
            manual_operator_actions=False,
            failed_only=False,
        )

        fake_client = type(
            "FakeClient",
            (),
            {
                "request": lambda self, method, path, payload=None, expected=(200,), label=None: {
                    "data": [
                        {
                            "id": "pb-v2",
                            "slug": "research-analysis",
                            "version": 2,
                            "is_active": True,
                            "name": "Research Analysis",
                        },
                        {
                            "id": "pb-v1",
                            "slug": "research-analysis",
                            "version": 1,
                            "is_active": False,
                            "name": "Research Analysis",
                        },
                    ]
                }
            },
        )()
        fake_api = type("FakeApi", (), {"client": fake_client, "list_local_playbooks": lambda self: fake_client.request("GET", "/api/v1/playbooks")["data"]})()

        observed_playbooks_by_slug: dict[str, dict[str, str]] = {}

        with patch("runner.prepare_environment", return_value={"specialist_model_id": "model-1", "specialist_reasoning": "medium"}):
            with patch("runner.create_catalog_api", return_value=fake_api):
                with patch("runner.import_full_catalog", return_value={"catalog_playbook_count": 17}):
                    with patch("runner.assign_specialist_model_to_roles", return_value=[]):
                        with patch("runner.configure_community_mcp_servers", return_value={"items": [], "by_slug": {}}):
                            with patch("runner.load_metadata", return_value={"workspace_profiles": {}, "runs": []}):
                                with patch("runner.validate_metadata"):
                                    with patch(
                                        "runner.resolve_run_specs",
                                        return_value=[
                                            {
                                                "id": "research-analysis-native-search",
                                                "batch": "matrix",
                                                "playbook_slug": "research-analysis",
                                                "variant": "native-search",
                                                "launch_inputs": {},
                                            }
                                        ],
                                    ):
                                        with patch(
                                            "runner.execute_runs",
                                            side_effect=lambda api, playbooks_by_slug, run_specs, **kwargs: observed_playbooks_by_slug.update(playbooks_by_slug) or {
                                                "runs": [],
                                                "passed": True,
                                                "passed_count": 0,
                                                "failed_count": 0,
                                            },
                                        ):
                                            community_runner.execute(args)

        self.assertEqual("pb-v2", observed_playbooks_by_slug["research-analysis"]["id"])

    def test_execute_uses_env_file_as_authoritative_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = Path(tmpdir) / "local.env"
            env_file.write_text(
                "\n".join(
                    [
                        "LIVE_TEST_PROVIDER_TYPE=anthropic",
                        "LIVE_TEST_MODEL_ID=test-model-alpha",
                        "LIVE_TEST_ORCHESTRATOR_MODEL_ID=test-model-alpha",  # pragma: allowlist secret
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            args = argparse.Namespace(
                bootstrap_only=True,
                import_only=False,
                batch=None,
                playbook=None,
                variant=None,
                provider=None,
                manual_operator_actions=False,
                failed_only=False,
            )

            with patch.dict(
                os.environ,
                {
                    "LIVE_TEST_ENV_FILE": str(env_file),
                    "LIVE_TEST_PROVIDER_TYPE": "openai",
                    "LIVE_TEST_MODEL_ID": "gpt-5.4",
                    "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "gpt-5.4",
                },
                clear=False,
            ):
                observed: dict[str, str] = {}

                def fake_prepare_environment() -> dict[str, str]:
                    observed["provider_type"] = os.environ["LIVE_TEST_PROVIDER_TYPE"]
                    observed["model_id"] = os.environ["LIVE_TEST_MODEL_ID"]
                    observed["orchestrator_model_id"] = os.environ["LIVE_TEST_ORCHESTRATOR_MODEL_ID"]
                    return {"specialist_model_id": "model-1", "specialist_reasoning": "low"}

                with patch("runner.prepare_environment", side_effect=fake_prepare_environment):
                    community_runner.execute(args)

            self.assertEqual("anthropic", observed["provider_type"])
            self.assertEqual("test-model-alpha", observed["model_id"])
            self.assertEqual("test-model-alpha", observed["orchestrator_model_id"])
