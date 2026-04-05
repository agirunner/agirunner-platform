#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlparse


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from community_run_api import CommunityRunApi


class FakeApiClient:
    def __init__(self, responses: list[object] | None = None) -> None:
        self._responses = list(responses or [])
        self.requests: list[dict[str, object]] = []

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


class CommunityRunApiTests(unittest.TestCase):
    def test_get_local_playbook_by_slug_returns_matching_playbook(self) -> None:
        client = FakeApiClient(
            responses=[
                {
                    "data": [
                        {"id": "pb-1", "slug": "bug-fix"},
                        {"id": "pb-2", "slug": "research-analysis"},
                    ]
                }
            ]
        )

        playbook = CommunityRunApi(client).get_local_playbook_by_slug("research-analysis")

        self.assertEqual("pb-2", playbook["id"])

    def test_create_workspace_posts_admin_payload(self) -> None:
        client = FakeApiClient(responses=[{"data": {"id": "ws-1"}}])

        workspace = CommunityRunApi(client).create_workspace({"slug": "bug-fix-smoke-workspace"})

        self.assertEqual({"id": "ws-1"}, workspace)
        self.assertEqual("/api/v1/workspaces", client.requests[0]["path"])
        self.assertEqual((201,), client.requests[0]["expected"])

    def test_submit_approval_posts_decision_payload(self) -> None:
        client = FakeApiClient(responses=[{"data": {"gate_id": "gate-1", "status": "approved"}}])

        result = CommunityRunApi(client).submit_approval(
            "gate-1",
            request_id="community-playbooks-approve-gate-1",
            action="approve",
            feedback="Ship it.",
        )

        self.assertEqual("approved", result["status"])
        self.assertEqual(
            {
                "request_id": "community-playbooks-approve-gate-1",
                "action": "approve",
                "feedback": "Ship it.",
            },
            client.requests[0]["payload"],
        )

    def test_get_workspace_packet_builds_expected_query(self) -> None:
        client = FakeApiClient(responses=[{"data": {"deliverables": {"final_deliverables": []}}}])

        packet = CommunityRunApi(client).get_workspace_packet(
            "workflow-1",
            work_item_id="work-item-9",
            live_console_limit=25,
            deliverables_limit=15,
            briefs_limit=10,
            history_limit=5,
        )

        self.assertIn("deliverables", packet)
        request_path = str(client.requests[0]["path"])
        parsed = urlparse(request_path)
        params = parse_qs(parsed.query)
        self.assertEqual("/api/v1/operations/workflows/workflow-1/workspace", parsed.path)
        self.assertEqual(["selected_work_item"], params["tab_scope"])
        self.assertEqual(["work-item-9"], params["work_item_id"])
        self.assertEqual(["25"], params["live_console_limit"])
        self.assertEqual(["15"], params["deliverables_limit"])
        self.assertEqual(["10"], params["briefs_limit"])
        self.assertEqual(["5"], params["history_limit"])

    def test_list_logs_omits_status_filter_when_none(self) -> None:
        client = FakeApiClient(responses=[{"data": []}])

        logs = CommunityRunApi(client).list_logs(workflow_id="workflow-1", status=None, per_page=50)

        self.assertEqual([], logs)
        request_path = str(client.requests[0]["path"])
        parsed = urlparse(request_path)
        params = parse_qs(parsed.query)
        self.assertEqual("/api/v1/logs", parsed.path)
        self.assertEqual(["workflow-1"], params["workflow_id"])
        self.assertEqual(["desc"], params["order"])
        self.assertEqual(["50"], params["per_page"])
        self.assertEqual(["full"], params["detail"])
        self.assertNotIn("status", params)

    def test_list_logs_follows_cursor_pagination_until_exhausted(self) -> None:
        client = FakeApiClient(
            responses=[
                {
                    "data": [{"id": "log-2"}],
                    "pagination": {"has_more": True, "next_cursor": "cursor-2"},
                },
                {
                    "data": [{"id": "log-1"}],
                    "pagination": {"has_more": False, "next_cursor": None},
                },
            ]
        )

        logs = CommunityRunApi(client).list_logs(workflow_id="workflow-1", status=None, per_page=50)

        self.assertEqual([{"id": "log-2"}, {"id": "log-1"}], logs)
        first_request_path = str(client.requests[0]["path"])
        second_request_path = str(client.requests[1]["path"])
        first_params = parse_qs(urlparse(first_request_path).query)
        second_params = parse_qs(urlparse(second_request_path).query)
        self.assertNotIn("cursor", first_params)
        self.assertEqual(["cursor-2"], second_params["cursor"])
        self.assertEqual(["full"], second_params["detail"])

    def test_read_api_path_fetches_arbitrary_preview_routes(self) -> None:
        payload = {"preview": "ok"}
        client = FakeApiClient(responses=[payload])

        preview = CommunityRunApi(client).read_api_path("/api/v1/tasks/task-1/artifacts/art-1/preview")

        self.assertEqual(payload, preview)
        self.assertEqual(
            "/api/v1/tasks/task-1/artifacts/art-1/preview",
            client.requests[0]["path"],
        )
        self.assertEqual((200,), client.requests[0]["expected"])


if __name__ == "__main__":
    unittest.main()
