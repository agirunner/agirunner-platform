#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import seed_live_test_environment as seed_env  # noqa: E402


class SeedProviderCatalogApiKeyTests(unittest.TestCase):
    def test_api_key_bootstrap_discovers_provider_models_before_assignment(self) -> None:
        client = _RecordingClient(
            responses=[
                {
                    "data": {
                        "id": "provider-1",
                        "name": "Anthropic",
                        "base_url": "https://api.anthropic.com",
                    }
                },
                {
                    "data": {
                        "discovered": [
                            {
                                "modelId": "claude-sonnet-4-6",
                                "endpointType": "messages",
                            }
                        ],
                        "created": [
                            {
                                "id": "model-record-1",
                                "provider_id": "provider-1",
                                "model_id": "claude-sonnet-4-6",
                                "endpoint_type": "messages",
                            }
                        ],
                    }
                },
                {"data": {}},
                {"data": {}},
            ]
        )

        provider, model, orchestrator_model, specialist_model = seed_env.seed_provider_catalog(
            client,
            auth_mode="api_key",
            provider_name="Anthropic",
            provider_type="anthropic",
            provider_base_url="https://api.anthropic.com",
            provider_api_key="anthropic-secret-ref",  # pragma: allowlist secret
            oauth_profile_id=None,
            oauth_session=None,
            model_id="claude-sonnet-4-6",
            model_endpoint_type="messages",
            system_reasoning_effort="medium",
            orchestrator_model_id="claude-sonnet-4-6",
            orchestrator_endpoint_type="messages",
            orchestrator_reasoning_effort="low",
            specialist_model_id="claude-sonnet-4-6",
            specialist_endpoint_type="messages",
            specialist_reasoning_effort="medium",
            roles=[],
        )

        self.assertEqual("provider-1", provider["id"])
        self.assertEqual("model-record-1", model["id"])
        self.assertEqual("model-record-1", orchestrator_model["id"])
        self.assertEqual("model-record-1", specialist_model["id"])
        self.assertIn(("POST", "/api/v1/config/llm/providers/provider-1/discover"), client.calls)
        self.assertNotIn(("POST", "/api/v1/config/llm/models"), client.calls)

    def test_api_key_bootstrap_reuses_first_created_model_for_orchestrator_and_specialists(self) -> None:
        client = _RecordingClient(
            responses=[
                {
                    "data": {
                        "id": "provider-1",
                        "name": "Anthropic",
                        "base_url": "https://api.anthropic.com",
                    }
                },
                {
                    "data": {
                        "discovered": [],
                        "created": [],
                    }
                },
                {
                    "data": {
                        "id": "model-record-1",
                        "provider_id": "provider-1",
                        "model_id": "claude-sonnet-4-6",
                        "endpoint_type": "messages",
                    }
                },
                {"data": {}},
                {"data": {}},
            ]
        )

        provider, model, orchestrator_model, specialist_model = seed_env.seed_provider_catalog(
            client,
            auth_mode="api_key",
            provider_name="Anthropic",
            provider_type="anthropic",
            provider_base_url="https://api.anthropic.com",
            provider_api_key="anthropic-secret-ref",  # pragma: allowlist secret
            oauth_profile_id=None,
            oauth_session=None,
            model_id="claude-sonnet-4-6",
            model_endpoint_type="messages",
            system_reasoning_effort="medium",
            orchestrator_model_id="claude-sonnet-4-6",
            orchestrator_endpoint_type="messages",
            orchestrator_reasoning_effort="low",
            specialist_model_id="claude-sonnet-4-6",
            specialist_endpoint_type="messages",
            specialist_reasoning_effort="medium",
            roles=[],
        )

        self.assertEqual("provider-1", provider["id"])
        self.assertEqual("model-record-1", model["id"])
        self.assertEqual("model-record-1", orchestrator_model["id"])
        self.assertEqual("model-record-1", specialist_model["id"])
        self.assertEqual(
            [("POST", "/api/v1/config/llm/models")],
            [call for call in client.calls if call == ("POST", "/api/v1/config/llm/models")],
        )


class _RecordingClient:
    def __init__(self, responses: list[object]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    def request(self, method: str, path: str, **kwargs):
        self.calls.append((method, path))
        if not self._responses:
            raise AssertionError(f"unexpected request: {method} {path}")
        return self._responses.pop(0)


if __name__ == "__main__":
    unittest.main()
