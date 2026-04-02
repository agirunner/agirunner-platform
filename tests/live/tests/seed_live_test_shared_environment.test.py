#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import seed_live_test_shared_environment as shared_seed  # noqa: E402


class SeedLiveTestSharedEnvironmentTests(unittest.TestCase):
    def test_workspace_cleanup_happens_before_llm_cleanup(self) -> None:
        calls: list[str] = []

        def record(name: str):
            def inner(*args, **kwargs):
                calls.append(name)
                if name == "sync_library_profiles":
                    return {"demo": {"role_names": ["policy-assessor"]}}
                if name == "ensure_live_test_execution_environments":
                    return {"aliases": {}, "default_candidates": [{"id": "env-1"}]}
                if name == "seed_provider_catalog":
                    return (
                        {"id": "provider-1"},
                        {"id": "model-1", "model_id": "gpt-5.4"},
                        {"id": "orch-model-1", "model_id": "gpt-5.4"},
                        {"id": "spec-model-1", "model_id": "gpt-5.4"},
                    )
                if name == "restart_orchestrator":
                    return {"worker": {"id": "worker-1"}, "containers": [{}, {}]}
                return None

            return inner

        with tempfile.TemporaryDirectory() as tmpdir:
            env = self.make_env(Path(tmpdir))
            with patch.dict(os.environ, env, clear=False), patch.object(
                shared_seed, "TraceRecorder", lambda trace_dir: {"trace_dir": trace_dir}
            ), patch.object(shared_seed, "ApiClient", StubApiClient), patch.object(
                shared_seed, "login", lambda client, admin_api_key: "token-1"
            ), patch.object(
                shared_seed, "delete_workspaces", record("delete_workspaces")
            ), patch.object(
                shared_seed,
                "ensure_live_test_execution_environments",
                record("ensure_live_test_execution_environments"),
            ), patch.object(
                shared_seed, "sync_library_profiles", record("sync_library_profiles")
            ), patch.object(
                shared_seed, "clear_assignments", record("clear_assignments")
            ), patch.object(
                shared_seed,
                "delete_models_and_providers",
                record("delete_models_and_providers"),
            ), patch.object(
                shared_seed, "seed_provider_catalog", record("seed_provider_catalog")
            ), patch.object(
                shared_seed, "restart_orchestrator", record("restart_orchestrator")
            ), patch.object(
                shared_seed, "emit_context", record("emit_context")
            ):
                shared_seed.main()

        self.assertLess(calls.index("delete_workspaces"), calls.index("clear_assignments"))
        self.assertLess(calls.index("delete_workspaces"), calls.index("delete_models_and_providers"))

    def test_workspace_cleanup_failure_does_not_clear_llm_state(self) -> None:
        calls: list[str] = []

        def fail_delete_workspaces(*args, **kwargs):
            calls.append("delete_workspaces")
            raise RuntimeError("workspace delete failed")

        with tempfile.TemporaryDirectory() as tmpdir:
            env = self.make_env(Path(tmpdir))
            with patch.dict(os.environ, env, clear=False), patch.object(
                shared_seed, "TraceRecorder", lambda trace_dir: {"trace_dir": trace_dir}
            ), patch.object(shared_seed, "ApiClient", StubApiClient), patch.object(
                shared_seed, "login", lambda client, admin_api_key: "token-1"
            ), patch.object(
                shared_seed, "delete_workspaces", fail_delete_workspaces
            ), patch.object(
                shared_seed, "clear_assignments", lambda *args, **kwargs: calls.append("clear_assignments")
            ), patch.object(
                shared_seed,
                "delete_models_and_providers",
                lambda *args, **kwargs: calls.append("delete_models_and_providers"),
            ):
                with self.assertRaisesRegex(RuntimeError, "workspace delete failed"):
                    shared_seed.main()

        self.assertEqual(calls, ["delete_workspaces"])

    def test_main_defaults_to_single_orchestrator_replica_and_low_openai_reasoning(self) -> None:
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
            env = self.make_env(Path(tmpdir))
            with patch.dict(os.environ, env, clear=False), patch.object(
                shared_seed, "TraceRecorder", lambda trace_dir: {"trace_dir": trace_dir}
            ), patch.object(shared_seed, "ApiClient", StubApiClient), patch.object(
                shared_seed, "login", lambda client, admin_api_key: "token-1"
            ), patch.object(
                shared_seed, "delete_workspaces", lambda *args, **kwargs: None
            ), patch.object(
                shared_seed, "clear_assignments", lambda *args, **kwargs: None
            ), patch.object(
                shared_seed, "delete_models_and_providers", lambda *args, **kwargs: None
            ), patch.object(
                shared_seed,
                "ensure_live_test_execution_environments",
                lambda *args, **kwargs: {"aliases": {}, "default_candidates": [{"id": "env-1"}]},
            ), patch.object(
                shared_seed,
                "sync_library_profiles",
                lambda *args, **kwargs: {"demo": {"role_names": ["policy-assessor"]}},
            ), patch.object(
                shared_seed, "seed_provider_catalog", fake_seed_provider_catalog
            ), patch.object(
                shared_seed, "restart_orchestrator", fake_restart_orchestrator
            ), patch.object(
                shared_seed, "emit_context", lambda context: None
            ):
                shared_seed.main()

        self.assertEqual("low", captured["system_reasoning_effort"])
        self.assertEqual("low", captured["orchestrator_reasoning_effort"])
        self.assertEqual("low", captured["specialist_reasoning_effort"])
        self.assertEqual(1, captured["replicas"])

    def make_env(self, root: Path) -> dict[str, str]:
        trace_dir = root / "trace"
        trace_dir.mkdir(parents=True)
        library_root = root / "library"
        library_root.mkdir(parents=True)
        return {
            "PLATFORM_API_BASE_URL": "http://127.0.0.1:8080",
            "LIVE_TEST_TRACE_DIR": str(trace_dir),
            "DEFAULT_ADMIN_API_KEY": "test-admin-key",
            "LIVE_TEST_LIBRARY_ROOT": str(library_root),
            "LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON": "{}",
            "LIVE_TEST_SHARED_BOOTSTRAP_KEY": "shared-key-1",
        }


class StubApiClient:
    def __init__(self, base_url: str, trace: object):
        self.base_url = base_url
        self.trace = trace

    def with_bearer_token(self, token: str, refresh):
        return self


if __name__ == "__main__":
    unittest.main()
