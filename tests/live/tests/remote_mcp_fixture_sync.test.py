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

import remote_mcp_fixture_sync  # noqa: E402


class FakeRemoteMcpClient:
    def __init__(self, *, authorize_kind: str = "completed") -> None:
        self.authorize_kind = authorize_kind
        self.remote_mcp_servers: list[dict[str, object]] = []
        self.calls: list[tuple[str, str, dict[str, object], tuple[int, ...], str | None]] = []

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

        if method == "GET" and path == "/api/v1/remote-mcp-servers":
            return {"data": list(self.remote_mcp_servers)}

        if method == "GET" and path.startswith("/api/v1/remote-mcp-servers/"):
            server_id = path.rsplit("/", 1)[-1]
            server = next(server for server in self.remote_mcp_servers if server["id"] == server_id)
            return {"data": server}

        if method == "POST" and path == "/api/v1/remote-mcp-servers/oauth/authorize":
            if self.authorize_kind != "completed":
                return {"data": build_authorize_response(self.authorize_kind)}
            created = build_saved_server(
                server_id=f"mcp-{len(self.remote_mcp_servers) + 1}",
                payload=payload,
                oauth_connected=True,
            )
            self.remote_mcp_servers.append(created)
            return {"data": {"kind": "completed", "serverId": created["id"], "serverName": created["name"]}}

        if method == "POST" and path.endswith("/oauth/reconnect"):
            server_id = path.split("/")[-3]
            existing = next(server for server in self.remote_mcp_servers if server["id"] == server_id)
            existing["oauth_connected"] = True
            return {"data": {"kind": "completed", "serverId": server_id, "serverName": existing["name"]}}

        if method == "PUT" and path.startswith("/api/v1/remote-mcp-servers/"):
            server_id = path.rsplit("/", 1)[-1]
            updated = build_saved_server(
                server_id=server_id,
                payload=payload,
                oauth_connected=True,
            )
            self.remote_mcp_servers = [server for server in self.remote_mcp_servers if server["id"] != server_id]
            self.remote_mcp_servers.append(updated)
            return {"data": updated}

        raise AssertionError(f"unexpected request: {method} {path}")


def build_authorize_response(kind: str) -> dict[str, object]:
    if kind == "browser":
        return {"kind": "browser", "draftId": "draft-1", "authorizeUrl": "https://auth.example.test/authorize"}
    if kind == "device":
        return {
            "kind": "device",
            "draftId": "draft-1",
            "deviceFlowId": "flow-1",
            "userCode": "ABCD",
            "verificationUri": "https://auth.example.test/device",
            "verificationUriComplete": "https://auth.example.test/device?user_code=ABCD",
            "expiresInSeconds": 600,
            "intervalSeconds": 5,
        }
    raise AssertionError(f"unexpected authorize result kind: {kind}")


def build_saved_server(
    *,
    server_id: str,
    payload: dict[str, object],
    oauth_connected: bool,
) -> dict[str, object]:
    return {
        "id": server_id,
        "name": payload["name"],
        "slug": str(payload["name"]).strip().lower().replace(" ", "-"),
        "description": payload.get("description", ""),
        "endpoint_url": payload["endpointUrl"],
        "call_timeout_seconds": payload.get("callTimeoutSeconds", 300),
        "auth_mode": payload["authMode"],
        "enabled_by_default_for_new_specialists": payload.get("enabledByDefaultForNewSpecialists", False),
        "verification_status": "verified",
        "verified_transport": "streamable_http",
        "discovered_tools_snapshot": [{"original_name": "search"}],
        "assigned_specialist_count": 0,
        "parameters": [],
        "oauth_connected": oauth_connected,
        "oauth_authorized_at": "2026-03-26T00:00:00.000Z" if oauth_connected else None,
        "oauth_needs_reauth": False,
        "is_archived": False,
    }


class RemoteMcpFixtureSyncTests(unittest.TestCase):
    def test_sync_remote_mcp_servers_creates_completed_oauth_server_via_authorize_route(self) -> None:
        client = FakeRemoteMcpClient()
        with tempfile.TemporaryDirectory() as tmpdir:
            fixture_path = Path(tmpdir) / "remote-mcp-servers.json"
            fixture_path.write_text(
                json.dumps(
                    [
                        {
                            "name": "OAuth Search",
                            "endpointUrl": "https://mcp.example.test/server",
                            "authMode": "oauth",
                            "oauthDefinition": {
                                "grantType": "client_credentials",
                                "clientStrategy": "manual_client",
                                "clientId": {"env": "LIVE_TEST_REMOTE_MCP_CLIENT_ID"},
                                "clientSecret": {"env": "LIVE_TEST_REMOTE_MCP_CLIENT_SECRET"},
                                "tokenEndpointAuthMethod": "client_secret_post",
                                "scopes": ["search:read"],
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )
            os.environ["LIVE_TEST_REMOTE_MCP_CLIENT_ID"] = "client-id"
            os.environ["LIVE_TEST_REMOTE_MCP_CLIENT_SECRET"] = "client-secret"

            registry = remote_mcp_fixture_sync.sync_remote_mcp_servers(client, fixture_path)

        self.assertEqual("oauth-search", registry["items"][0]["slug"])
        self.assertTrue(registry["items"][0]["oauth_connected"])
        authorize_call = next(
            call
            for call in client.calls
            if call[0] == "POST" and call[1] == "/api/v1/remote-mcp-servers/oauth/authorize"
        )
        self.assertEqual("oauth", authorize_call[2]["authMode"])
        self.assertEqual("client_credentials", authorize_call[2]["oauthDefinition"]["grantType"])
        self.assertEqual("client-id", authorize_call[2]["oauthDefinition"]["clientId"])
        self.assertEqual("client-secret", authorize_call[2]["oauthDefinition"]["clientSecret"])

    def test_sync_remote_mcp_servers_rejects_interactive_browser_oauth_seed(self) -> None:
        client = FakeRemoteMcpClient(authorize_kind="browser")
        with tempfile.TemporaryDirectory() as tmpdir:
            fixture_path = Path(tmpdir) / "remote-mcp-servers.json"
            fixture_path.write_text(
                json.dumps(
                    [
                        {
                            "name": "Browser OAuth Search",
                            "endpointUrl": "https://mcp.example.test/server",
                            "authMode": "oauth",
                            "oauthDefinition": {
                                "grantType": "authorization_code",
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "interactive browser authorization"):
                remote_mcp_fixture_sync.sync_remote_mcp_servers(client, fixture_path)

    def test_sync_remote_mcp_servers_updates_existing_connected_oauth_server_via_put(self) -> None:
        client = FakeRemoteMcpClient()
        client.remote_mcp_servers = [
            build_saved_server(
                server_id="mcp-1",
                payload={
                    "name": "OAuth Search",
                    "description": "old",
                    "endpointUrl": "https://mcp.example.test/server",
                    "callTimeoutSeconds": 300,
                    "authMode": "oauth",
                },
                oauth_connected=True,
            )
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            fixture_path = Path(tmpdir) / "remote-mcp-servers.json"
            fixture_path.write_text(
                json.dumps(
                    [
                        {
                            "name": "OAuth Search",
                            "description": "updated",
                            "endpointUrl": "https://mcp.example.test/server",
                            "authMode": "oauth",
                            "oauthDefinition": {
                                "grantType": "client_credentials",
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            remote_mcp_fixture_sync.sync_remote_mcp_servers(client, fixture_path)

        call_pairs = [(method, path) for method, path, _, _, _ in client.calls]
        self.assertIn(("PUT", "/api/v1/remote-mcp-servers/mcp-1"), call_pairs)
        self.assertNotIn(("POST", "/api/v1/remote-mcp-servers/oauth/authorize"), call_pairs)


if __name__ == "__main__":
    unittest.main()
