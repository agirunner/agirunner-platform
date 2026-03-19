#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import seed_live_test_environment  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], tuple[int, ...], str | None]] = []
        self.models: list[dict[str, object]] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, object]:
        payload = payload or {}
        self.calls.append((method, path, payload, expected, label))

        if method == "POST" and path == "/api/v1/config/llm/models":
            created = {
                "id": f"model-{payload['modelId']}",
                "provider_id": payload["providerId"],
                "model_id": payload["modelId"],
                "endpoint_type": payload["endpointType"],
                "reasoning_config": payload["reasoningConfig"],
            }
            self.models.append(created)
            return {"data": created}

        if method == "PUT" and path.startswith("/api/v1/config/llm/assignments/"):
            role_name = path.rsplit("/", 1)[-1]
            return {
                "data": {
                    "role_name": role_name,
                    "primary_model_id": payload["primaryModelId"],
                    "reasoning_config": payload["reasoningConfig"],
                }
            }

        raise AssertionError(f"unexpected request: {method} {path}")


class SeedLiveTestEnvironmentTests(unittest.TestCase):
    def test_ensure_specialist_assignments_creates_missing_model_and_assigns_all_roles(self) -> None:
        client = FakeClient()
        roles = [
            {"name": "live-test-product-manager"},
            {"name": "live-test-architect"},
            {"name": "live-test-developer"},
        ]

        specialist_model = seed_live_test_environment.ensure_specialist_assignments(
            client,
            provider_id="provider-1",
            existing_models=[
                {
                    "id": "model-gpt-5.4",
                    "provider_id": "provider-1",
                    "model_id": "gpt-5.4",
                    "endpoint_type": "responses",
                    "reasoning_config": {"type": "effort", "default": "low", "options": ["low", "medium"]},
                }
            ],
            roles=roles,
            specialist_model_id="gpt-5.4-mini",
            specialist_endpoint_type="responses",
            specialist_reasoning_effort="medium",
        )

        self.assertEqual("model-gpt-5.4-mini", specialist_model["id"])
        self.assertEqual(
            [
                ("POST", "/api/v1/config/llm/models"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-product-manager"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-architect"),
                ("PUT", "/api/v1/config/llm/assignments/live-test-developer"),
            ],
            [(method, path) for method, path, _, _, _ in client.calls],
        )
        for _, path, payload, _, _ in client.calls[1:]:
            self.assertEqual("model-gpt-5.4-mini", payload["primaryModelId"])
            self.assertEqual({"effort": "medium", "reasoning_effort": "medium"}, payload["reasoningConfig"])
            self.assertIn(path.rsplit("/", 1)[-1], {role["name"] for role in roles})

    def test_ensure_specialist_assignments_reuses_existing_model_when_present(self) -> None:
        client = FakeClient()
        specialist_model = seed_live_test_environment.ensure_specialist_assignments(
            client,
            provider_id="provider-1",
            existing_models=[
                {
                    "id": "model-gpt-5.4-mini",
                    "provider_id": "provider-1",
                    "model_id": "gpt-5.4-mini",
                    "endpoint_type": "responses",
                    "reasoning_config": {"type": "effort", "default": "medium", "options": ["low", "medium"]},
                }
            ],
            roles=[{"name": "live-test-qa"}],
            specialist_model_id="gpt-5.4-mini",
            specialist_endpoint_type="responses",
            specialist_reasoning_effort="medium",
        )

        self.assertEqual("model-gpt-5.4-mini", specialist_model["id"])
        self.assertEqual(
            [("PUT", "/api/v1/config/llm/assignments/live-test-qa")],
            [(method, path) for method, path, _, _, _ in client.calls],
        )


if __name__ == "__main__":
    unittest.main()
