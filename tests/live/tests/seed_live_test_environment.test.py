#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import seed_live_test_environment as seed_env  # noqa: E402


class SeedLiveTestEnvironmentTests(unittest.TestCase):
    def test_require_refreshable_oauth_session_normalizes_flat_db_export_payload(self) -> None:
        normalized = seed_env.require_refreshable_oauth_session(
            {
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "expires_at": 1775713413699,
                "account_id": "account-1",
                "email": "operator@example.com",
                "authorized_at": "2026-03-31T00:00:00.000Z",
                "authorized_by_user_id": "user-1",
                "needs_reauth": False,
            }
        )

        self.assertEqual(
            {
                "credentials": {
                    "accessToken": "access-token",
                    "refreshToken": "refresh-token",
                    "expiresAt": 1775713413699,
                    "accountId": "account-1",
                    "email": "operator@example.com",
                    "authorizedAt": "2026-03-31T00:00:00.000Z",
                    "authorizedByUserId": "user-1",
                    "needsReauth": False,
                }
            },
            normalized,
        )

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

    def test_seed_provider_catalog_imports_normalized_flat_db_oauth_session(self) -> None:
        client = _RecordingOauthClient()

        provider, model, orchestrator_model, specialist_model = seed_env.seed_provider_catalog(
            client,
            auth_mode="oauth",
            provider_name="OpenAI (Subscription)",
            provider_type="openai",
            provider_base_url="https://chatgpt.com/backend-api",
            provider_api_key=None,
            oauth_profile_id="openai-codex",
            oauth_session={
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "authorized_at": "2026-03-31T00:00:00.000Z",
                "authorized_by_user_id": "user-1",
                "needs_reauth": False,
            },
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

        self.assertEqual(
            {
                "profileId": "openai-codex",
                "providerName": "OpenAI (Subscription)",
                "credentials": {
                    "accessToken": "access-token",
                    "refreshToken": "refresh-token",
                    "authorizedAt": "2026-03-31T00:00:00.000Z",
                    "authorizedByUserId": "user-1",
                    "needsReauth": False,
                },
            },
            client.import_payload,
        )
        self.assertEqual("provider-1", provider["id"])
        self.assertEqual("model-record-1", model["id"])
        self.assertEqual("model-record-1", orchestrator_model["id"])
        self.assertEqual("model-record-1", specialist_model["id"])


class _UnexpectedClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def request(self, method: str, path: str, **kwargs):
        self.calls.append((method, path))
        raise AssertionError("client.request should not be reached for invalid oauth sessions")


class _RecordingOauthClient:
    def __init__(self) -> None:
        self.import_payload = None

    def request(self, method: str, path: str, **kwargs):
        if method == "POST" and path == "/api/v1/config/oauth/import-session":
            self.import_payload = kwargs["payload"]
            return {"data": {"providerId": "provider-1", "email": "operator@example.com"}}

        if method == "POST" and path == "/api/v1/config/llm/providers/provider-1/discover":
            return {
                "data": {
                    "created": [
                        {
                            "id": "model-record-1",
                            "provider_id": "provider-1",
                            "model_id": "gpt-5.4",
                            "endpoint_type": "responses",
                        }
                    ]
                }
            }

        if method == "PUT" and path == "/api/v1/config/llm/system-default":
            return {"data": {}}

        if method == "PUT" and path == "/api/v1/config/llm/assignments/orchestrator":
            return {"data": {}}

        raise AssertionError(f"unexpected request: {method} {path}")


if __name__ == "__main__":
    unittest.main()
