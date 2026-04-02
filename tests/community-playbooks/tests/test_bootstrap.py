#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
import sys

if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from bootstrap import BOOTSTRAP_CONTEXT_PATH, prepare_environment, seed_environment_context


class BootstrapTests(unittest.TestCase):
    def test_prepare_environment_runs_suite_bootstrap_script_and_reads_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            expected_context = {
                "specialist_model_id": "model-specialist",
                "specialist_reasoning": "medium",
            }
            with patch("bootstrap.results_root", return_value=Path(tmpdir)):
                with patch("bootstrap.run_command") as run_command_mock:
                    with patch("bootstrap.read_json_file", return_value=expected_context) as read_json_mock:
                        context = prepare_environment()

        self.assertEqual(expected_context, context)
        run_command_mock.assert_called_once_with(
            ["bash", str(prepare_environment.__globals__["PREPARE_SCRIPT"])],
            cwd=prepare_environment.__globals__["repo_root"](),
            capture_output=True,
            env={"LIVE_TEST_ENV_LOAD_MODE": "preserve_existing"},
        )
        read_json_mock.assert_called_once_with(Path(tmpdir) / BOOTSTRAP_CONTEXT_PATH)

    def test_seed_environment_context_defaults_to_single_orchestrator_replica_and_low_openai_reasoning(self) -> None:
        captured: dict[str, object] = {}

        def fake_seed_provider_catalog(*args, **kwargs):
            captured["system_reasoning_effort"] = kwargs["system_reasoning_effort"]
            captured["orchestrator_reasoning_effort"] = kwargs["orchestrator_reasoning_effort"]
            captured["specialist_reasoning_effort"] = kwargs["specialist_reasoning_effort"]
            return (
                {"id": "provider-1"},
                {"id": "model-1", "model_id": "gpt-5.4"},
                {"id": "orch-model-1", "model_id": "gpt-5.4"},
                {"id": "spec-model-1", "model_id": "gpt-5.4"},
            )

        def fake_restart_orchestrator(client, worker_name, runtime_image, replicas):
            captured["replicas"] = replicas
            return {"worker": {"id": "worker-1"}, "containers": [{}]}

        with tempfile.TemporaryDirectory() as tmpdir:
            env = {
                "DEFAULT_ADMIN_API_KEY": "test-admin-key",
                "COMMUNITY_PLAYBOOKS_RESULTS_DIR": tmpdir,
            }
            with patch.dict("os.environ", env, clear=False), patch(
                "bootstrap.create_api_client", return_value=_StubClient()
            ), patch(
                "bootstrap.login", return_value="token-1"
            ), patch(
                "bootstrap.delete_workspaces"
            ), patch(
                "bootstrap.clear_assignments"
            ), patch(
                "bootstrap.delete_models_and_providers"
            ), patch(
                "bootstrap.clear_existing_catalog_state"
            ), patch(
                "bootstrap.ensure_live_test_execution_environments",
                return_value={"aliases": {}, "default_candidates": [{"id": "env-1"}]},
            ), patch(
                "bootstrap.seed_provider_catalog", side_effect=fake_seed_provider_catalog
            ), patch(
                "bootstrap.restart_orchestrator", side_effect=fake_restart_orchestrator
            ), patch(
                "bootstrap.write_json_file"
            ), patch(
                "bootstrap.CommunityCatalogApi", return_value=object()
            ):
                context = seed_environment_context()

        self.assertEqual("low", captured["system_reasoning_effort"])
        self.assertEqual("low", captured["orchestrator_reasoning_effort"])
        self.assertEqual("low", captured["specialist_reasoning_effort"])
        self.assertEqual(1, captured["replicas"])
        self.assertEqual(1, context["orchestrator_replica_count"])


class _StubClient:
    def with_bearer_token(self, token, refresh):
        return self


if __name__ == "__main__":
    unittest.main()
