#!/usr/bin/env python3
from __future__ import annotations

import unittest

from pathlib import Path
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from community_catalog_api import CommunityCatalogApi
from import_catalog import import_full_catalog


class FakeApiClient:
    def __init__(self, responses: list[object] | None = None, *, authed_client: object | None = None) -> None:
        self._responses = list(responses or [])
        self.authed_client = authed_client if authed_client is not None else object()
        self.requests: list[dict[str, object]] = []
        self.refresh_callbacks: list[object] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> object:
        self.requests.append(
            {
                "method": method,
                "path": path,
                "payload": payload,
                "expected": expected,
                "label": label,
            }
        )
        if not self._responses:
            raise AssertionError(f"unexpected request without queued response: {method} {path}")
        return self._responses.pop(0)

    def with_bearer_token(self, token: str, refresh_callback: object) -> object:
        self.refresh_callbacks.append(refresh_callback)
        return self.authed_client


class StubCatalogApi:
    def __init__(self) -> None:
        self.preview_ids: list[str] | None = None
        self.import_ids: list[str] | None = None

    def list_catalog_playbooks(self) -> list[dict[str, str]]:
        return [
            {"id": "bug-fix", "slug": "bug-fix"},
            {"id": "research-analysis", "slug": "research-analysis"},
        ]

    def preview_import(self, playbook_ids: list[str]) -> dict[str, object]:
        self.preview_ids = list(playbook_ids)
        return {"selectionCount": len(playbook_ids)}

    def import_playbooks(self, playbook_ids: list[str], *, default_conflict_resolution: str = "override_existing") -> dict[str, object]:
        self.import_ids = list(playbook_ids)
        return {
            "importBatchId": "batch-1",
            "importedPlaybooks": [
                {"catalogId": "bug-fix", "localEntityId": "pb-1", "localSlug": "bug-fix"},
                {
                    "catalogId": "research-analysis",
                    "localEntityId": "pb-2",
                    "localSlug": "research-analysis",
                },
            ],
        }


class EmptyCatalogApi(StubCatalogApi):
    def list_catalog_playbooks(self) -> list[dict[str, str]]:
        return []


class CommunityCatalogApiTests(unittest.TestCase):
    def test_login_uses_admin_auth_route(self) -> None:
        authed_client = object()
        client = FakeApiClient(
            responses=[{"data": {"token": "token-123"}}],
            authed_client=authed_client,
        )

        authenticated = CommunityCatalogApi(client).login("admin-key")

        self.assertIs(authed_client, authenticated)
        self.assertEqual(
            [
                {
                    "method": "POST",
                    "path": "/api/v1/auth/login",
                    "payload": {"api_key": "admin-key"},
                    "expected": (200,),
                    "label": "auth.login",
                }
            ],
            client.requests,
        )
        self.assertEqual(1, len(client.refresh_callbacks))

    def test_upsert_role_assignment_sets_primary_model_and_reasoning(self) -> None:
        client = FakeApiClient(responses=[{"data": {"role_name": "research-assistant"}}])

        payload = CommunityCatalogApi(client).upsert_role_assignment(
            "research-assistant",
            primary_model_id="model-123",
            reasoning_effort="medium",
        )

        self.assertEqual({"role_name": "research-assistant"}, payload)
        self.assertEqual(
            [
                {
                    "method": "PUT",
                    "path": "/api/v1/config/llm/assignments/research-assistant",
                    "payload": {
                        "primaryModelId": "model-123",
                        "reasoningConfig": {"effort": "medium", "reasoning_effort": "medium"},
                    },
                    "expected": (200,),
                    "label": "llm.assignments.update:research-assistant",
                }
            ],
            client.requests,
        )


class ImportCatalogTests(unittest.TestCase):
    def test_import_full_catalog_selects_all_catalog_ids_and_normalizes_by_slug(self) -> None:
        api = StubCatalogApi()

        result = import_full_catalog(api)

        self.assertEqual(["bug-fix", "research-analysis"], api.preview_ids)
        self.assertEqual(["bug-fix", "research-analysis"], api.import_ids)
        self.assertEqual(2, result["catalog_playbook_count"])
        self.assertEqual({"selectionCount": 2}, result["preview"])
        self.assertEqual("pb-1", result["imported_by_slug"]["bug-fix"]["localEntityId"])
        self.assertEqual(
            "research-analysis",
            result["imported_by_slug"]["research-analysis"]["localSlug"],
        )

    def test_import_full_catalog_rejects_empty_catalog(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "did not return any playbooks"):
            import_full_catalog(EmptyCatalogApi())


if __name__ == "__main__":
    unittest.main()
