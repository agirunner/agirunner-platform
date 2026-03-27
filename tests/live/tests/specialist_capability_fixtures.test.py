#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import specialist_capability_fixtures  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.skills: list[dict[str, object]] = []
        self.remote_mcp_servers: list[dict[str, object]] = []
        self.calls: list[tuple[str, str, dict[str, object], str | None]] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        expected: tuple[int, ...] = (200,),
        label: str | None = None,
    ) -> dict[str, object]:
        del expected
        payload = payload or {}
        self.calls.append((method, path, payload, label))

        if method == "GET" and path == "/api/v1/specialist-skills":
            return {"data": list(self.skills)}

        if method == "POST" and path == "/api/v1/specialist-skills":
            created = {
                "id": f"skill-{len(self.skills) + 1}",
                "name": payload["name"],
                "slug": payload.get("slug") or str(payload["name"]).strip().lower().replace(" ", "-"),
                "summary": payload["summary"],
                "content": payload["content"],
                "is_archived": False,
            }
            self.skills.append(created)
            return {"data": created}

        if method == "PUT" and path.startswith("/api/v1/specialist-skills/"):
            skill_id = path.rsplit("/", 1)[-1]
            created = {
                "id": skill_id,
                "name": payload["name"],
                "slug": payload.get("slug") or str(payload["name"]).strip().lower().replace(" ", "-"),
                "summary": payload["summary"],
                "content": payload["content"],
                "is_archived": False,
            }
            self.skills = [skill for skill in self.skills if skill["id"] != skill_id]
            self.skills.append(created)
            return {"data": created}

        if method == "GET" and path == "/api/v1/remote-mcp-servers":
            return {"data": list(self.remote_mcp_servers)}

        if method == "POST" and path == "/api/v1/remote-mcp-servers":
            created = {
                "id": f"mcp-{len(self.remote_mcp_servers) + 1}",
                "name": payload["name"],
                "slug": str(payload["name"]).strip().lower().replace(" ", "-"),
                "description": payload.get("description", ""),
                "endpoint_url": payload["endpointUrl"],
                "auth_mode": payload["authMode"],
                "enabled_by_default_for_new_specialists": payload.get("enabledByDefaultForNewSpecialists", False),
                "verification_status": "verified",
                "verified_transport": "streamable_http",
                "discovered_tools_snapshot": [{"original_name": "search"}],
                "assigned_specialist_count": 0,
                "parameters": [
                    {
                        "id": "param-1",
                        "placement": parameter["placement"],
                        "key": parameter["key"],
                        "value_kind": parameter["valueKind"],
                        "value": parameter["value"],
                        "has_stored_secret": parameter["valueKind"] == "secret",
                    }
                    for parameter in payload.get("parameters", [])
                    if isinstance(parameter, dict)
                ],
                "oauth_connected": False,
                "oauth_authorized_at": None,
                "oauth_needs_reauth": False,
                "is_archived": False,
            }
            self.remote_mcp_servers.append(created)
            return {"data": created}

        if method == "PUT" and path.startswith("/api/v1/remote-mcp-servers/"):
            server_id = path.rsplit("/", 1)[-1]
            created = {
                "id": server_id,
                "name": payload["name"],
                "slug": str(payload["name"]).strip().lower().replace(" ", "-"),
                "description": payload.get("description", ""),
                "endpoint_url": payload["endpointUrl"],
                "auth_mode": payload["authMode"],
                "enabled_by_default_for_new_specialists": payload.get("enabledByDefaultForNewSpecialists", False),
                "verification_status": "verified",
                "verified_transport": "streamable_http",
                "discovered_tools_snapshot": [{"original_name": "search"}],
                "assigned_specialist_count": 0,
                "parameters": [
                    {
                        "id": "param-1",
                        "placement": parameter["placement"],
                        "key": parameter["key"],
                        "value_kind": parameter["valueKind"],
                        "value": parameter["value"],
                        "has_stored_secret": parameter["valueKind"] == "secret",
                    }
                    for parameter in payload.get("parameters", [])
                    if isinstance(parameter, dict)
                ],
                "oauth_connected": False,
                "oauth_authorized_at": None,
                "oauth_needs_reauth": False,
                "is_archived": False,
            }
            self.remote_mcp_servers = [server for server in self.remote_mcp_servers if server["id"] != server_id]
            self.remote_mcp_servers.append(created)
            return {"data": created}

        raise AssertionError(f"unexpected request: {method} {path}")


class SpecialistCapabilityFixturesTests(unittest.TestCase):
    def test_sync_profile_capabilities_seeds_skills_and_remote_mcp_servers(self) -> None:
        client = FakeClient()
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir)
            (profile_dir / "skills.json").write_text(
                json.dumps(
                    [
                        {
                            "name": "Structured Summary",
                            "slug": "structured-summary",
                            "summary": "Use the expected heading.",
                            "content": "Always include the heading SKILL_EVIDENCE in the final deliverable.",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            (profile_dir / "remote-mcp-servers.json").write_text(
                json.dumps(
                    [
                        {
                            "name": "Tavily Search",
                            "description": "Search the web.",
                            "endpointUrl": {"env": "LIVE_TEST_MCP_ENDPOINT"},
                            "authMode": "parameterized",
                            "parameters": [
                                {
                                    "placement": "query",
                                    "key": "apiKey",
                                    "valueKind": "secret",
                                    "value": {"template": "Bearer ${LIVE_TEST_MCP_API_KEY}"},
                                }
                            ],
                        }
                    ]
                ),
                encoding="utf-8",
            )

            os.environ["LIVE_TEST_MCP_ENDPOINT"] = "https://mcp.example.test/endpoint"
            os.environ["LIVE_TEST_MCP_API_KEY"] = "secret-token"
            registry = specialist_capability_fixtures.sync_profile_capabilities(client, profile_dir=profile_dir)

        self.assertEqual(
            [
                {
                    "id": "skill-1",
                    "name": "Structured Summary",
                    "slug": "structured-summary",
                }
            ],
            registry["skills"],
        )
        self.assertEqual(
            [
                {
                    "id": "mcp-1",
                    "name": "Tavily Search",
                    "slug": "tavily-search",
                    "auth_mode": "parameterized",
                    "verified_transport": "streamable_http",
                    "discovered_tool_names": ["search"],
                }
            ],
            registry["remote_mcp_servers"],
        )
        server_call = next(call for call in client.calls if call[1] == "/api/v1/remote-mcp-servers" and call[0] == "POST")
        self.assertEqual("https://mcp.example.test/endpoint", server_call[2]["endpointUrl"])
        self.assertEqual("Bearer secret-token", server_call[2]["parameters"][0]["value"])

    def test_resolve_role_capability_refs_converts_skill_and_mcp_slugs_to_ids(self) -> None:
        payload = {
            "name": "research-specialist",
            "skillSlugs": ["structured-summary"],
            "mcpServerSlugs": ["tavily-search"],
        }
        registry = {
            "skills_by_slug": {"structured-summary": {"id": "skill-1", "slug": "structured-summary"}},
            "remote_mcp_servers_by_slug": {"tavily-search": {"id": "mcp-1", "slug": "tavily-search"}},
        }

        resolved_payload, summary = specialist_capability_fixtures.resolve_role_capability_refs(
            payload,
            registry=registry,
        )

        self.assertEqual(["skill-1"], resolved_payload["skillIds"])
        self.assertEqual(["mcp-1"], resolved_payload["mcpServerIds"])
        self.assertNotIn("skillSlugs", resolved_payload)
        self.assertNotIn("mcpServerSlugs", resolved_payload)
        self.assertEqual(
            {
                "skill_slugs": ["structured-summary"],
                "mcp_server_slugs": ["tavily-search"],
            },
            summary,
        )


if __name__ == "__main__":
    unittest.main()
