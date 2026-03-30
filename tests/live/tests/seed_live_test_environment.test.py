#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import seed_live_test_environment as seed_env  # noqa: E402


class SeedLiveTestEnvironmentTests(unittest.TestCase):
    def test_require_refreshable_oauth_session_rejects_missing_refresh_token(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "refreshToken"):
            seed_env.require_refreshable_oauth_session(
                {
                    "credentials": {
                        "accessToken": "access-token",
                    }
                }
            )

    def test_require_refreshable_oauth_session_rejects_needs_reauth_flag(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "requires reauthorization"):
            seed_env.require_refreshable_oauth_session(
                {
                    "credentials": {
                        "accessToken": "access-token",
                        "refreshToken": "refresh-token",
                        "needsReauth": True,
                    }
                }
            )

    def test_seed_provider_catalog_rejects_non_refreshable_oauth_session_before_import(self) -> None:
        client = _UnexpectedClient()

        with self.assertRaisesRegex(RuntimeError, "refreshToken"):
            seed_env.seed_provider_catalog(
                client,
                auth_mode="oauth",
                provider_name="OpenAI (Subscription)",
                provider_type="openai",
                provider_base_url="https://chatgpt.com/backend-api",
                provider_api_key=None,
                oauth_profile_id="openai-codex",
                oauth_session={"credentials": {"accessToken": "access-token"}},
                model_id="gpt-5.4",
                model_endpoint_type="responses",
                system_reasoning_effort="medium",
                orchestrator_model_id="gpt-5.4",
                orchestrator_endpoint_type="responses",
                orchestrator_reasoning_effort="low",
                specialist_model_id="gpt-5.4",
                specialist_endpoint_type="responses",
                specialist_reasoning_effort="medium",
                roles=[],
            )

        self.assertEqual([], client.calls)


class _UnexpectedClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def request(self, method: str, path: str, **kwargs):
        self.calls.append((method, path))
        raise AssertionError("client.request should not be reached for invalid oauth sessions")


if __name__ == "__main__":
    unittest.main()
