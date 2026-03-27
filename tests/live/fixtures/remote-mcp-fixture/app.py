#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


HOST = "0.0.0.0"
PORT = int(os.environ.get("FIXTURE_PORT", "18080"))
BASE_URL = os.environ.get("FIXTURE_BASE_URL", f"http://live-test-remote-mcp-fixture:{PORT}").rstrip("/")
CLIENT_ID = os.environ.get("FIXTURE_CLIENT_ID", "live-test-client")
CLIENT_SECRET = os.environ.get("FIXTURE_CLIENT_SECRET", "live-test-secret")
ACCESS_TOKEN = os.environ.get("FIXTURE_ACCESS_TOKEN", "live-test-access-token")
SESSION_ID = "live-test-session"
PROTOCOL_VERSION = "2025-03-26"

MCP_ENDPOINT = "/mcp/client-credentials"
PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp/client-credentials"
AUTHORIZATION_SERVER_PATH = "/oauth/client-credentials"
AUTHORIZATION_SERVER_METADATA_PATH = "/oauth/client-credentials/.well-known/oauth-authorization-server"
OPENID_METADATA_PATH = "/oauth/client-credentials/.well-known/openid-configuration"
TOKEN_PATH = "/oauth/client-credentials/token"
DOC_PATH = "/docs/client-credentials"


class RemoteMcpFixtureHandler(BaseHTTPRequestHandler):
    server_version = "LiveTestRemoteMcpFixture/1.0"

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            self.send_text(HTTPStatus.OK, "ok\n")
            return
        if path == DOC_PATH:
            self.send_text(
                HTTPStatus.OK,
                "OAuth client-credentials MCP fixture. Reference answer: Victoria.\n",
            )
            return
        if path == MCP_ENDPOINT:
            self.send_unauthorized_challenge()
            return
        if path in {PROTECTED_RESOURCE_METADATA_PATH, f"{MCP_ENDPOINT}/.well-known/oauth-protected-resource"}:
            self.send_json(
                HTTPStatus.OK,
                {
                    "resource": f"{BASE_URL}{MCP_ENDPOINT}",
                    "authorization_servers": [f"{BASE_URL}{AUTHORIZATION_SERVER_PATH}"],
                },
            )
            return
        if path in {AUTHORIZATION_SERVER_METADATA_PATH, OPENID_METADATA_PATH}:
            self.send_json(
                HTTPStatus.OK,
                {
                    "issuer": f"{BASE_URL}{AUTHORIZATION_SERVER_PATH}",
                    "token_endpoint": f"{BASE_URL}{TOKEN_PATH}",
                    "grant_types_supported": ["client_credentials"],
                    "token_endpoint_auth_methods_supported": [
                        "client_secret_post",
                        "client_secret_basic",
                    ],
                    "code_challenge_methods_supported": ["S256"],
                },
            )
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == TOKEN_PATH:
            self.handle_token_exchange()
            return
        if path == MCP_ENDPOINT:
            self.handle_mcp_request()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == MCP_ENDPOINT:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return

    def handle_token_exchange(self) -> None:
        params = self.read_form_payload()
        client_id, client_secret = self.read_client_credentials(params)
        if client_id != CLIENT_ID or client_secret != CLIENT_SECRET:
            self.send_json(
                HTTPStatus.UNAUTHORIZED,
                {"error": "invalid_client", "error_description": "Client authentication failed"},
            )
            return
        if params.get("grant_type") != ["client_credentials"]:
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "unsupported_grant_type", "error_description": "Only client_credentials is supported"},
            )
            return
        self.send_json(
            HTTPStatus.OK,
            {
                "access_token": ACCESS_TOKEN,
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "fixture.search.read",
            },
        )

    def handle_mcp_request(self) -> None:
        if not self.has_valid_authorization():
            self.send_unauthorized_challenge()
            return
        request = self.read_json_payload()
        request_id = request.get("id")
        method = str(request.get("method") or "").strip()
        params = request.get("params") if isinstance(request.get("params"), dict) else {}

        if method == "initialize":
            self.send_mcp_result(
                request_id,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "live-test-remote-mcp-fixture", "version": "1"},
                },
            )
            return
        if method == "notifications/initialized":
            self.send_response(HTTPStatus.ACCEPTED)
            self.end_headers()
            return
        if method == "tools/list":
            self.send_mcp_result(
                request_id,
                {
                    "tools": [
                        {
                            "name": "lookup_reference_answer",
                            "description": "Return the deterministic live-test reference answer.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "topic": {"type": "string"},
                                },
                                "required": ["topic"],
                                "additionalProperties": False,
                            },
                        }
                    ]
                },
            )
            return
        if method == "tools/call":
            tool_name = str(params.get("name") or "").strip()
            arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
            if tool_name != "lookup_reference_answer":
                self.send_mcp_error(request_id, -32601, f"Unknown tool {tool_name!r}")
                return
            topic = str(arguments.get("topic") or "British Columbia capital").strip()
            self.send_mcp_result(
                request_id,
                {
                    "answer": "Victoria",
                    "answer_line": "Answer: Victoria",
                    "topic": topic,
                    "source_url": f"{BASE_URL}{DOC_PATH}",
                },
            )
            return
        self.send_mcp_error(request_id, -32601, f"Unsupported method {method!r}")

    def read_json_payload(self) -> dict[str, object]:
        body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
        if not body:
            return {}
        payload = json.loads(body.decode("utf-8"))
        return payload if isinstance(payload, dict) else {}

    def read_form_payload(self) -> dict[str, list[str]]:
        body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0")).decode("utf-8")
        return parse_qs(body, keep_blank_values=True)

    def read_client_credentials(self, params: dict[str, list[str]]) -> tuple[str | None, str | None]:
        client_id = first_value(params.get("client_id"))
        client_secret = first_value(params.get("client_secret"))
        if client_id and client_secret:
            return client_id, client_secret

        header = self.headers.get("Authorization", "")
        if not header.lower().startswith("basic "):
            return client_id, client_secret
        encoded = header.split(" ", 1)[1].strip()
        decoded = base64.b64decode(encoded).decode("utf-8")
        if ":" not in decoded:
            return None, None
        basic_id, basic_secret = decoded.split(":", 1)
        return basic_id, basic_secret

    def has_valid_authorization(self) -> bool:
        header = self.headers.get("Authorization", "")
        return header.strip() == f"Bearer {ACCESS_TOKEN}"

    def send_unauthorized_challenge(self) -> None:
        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header(
            "WWW-Authenticate",
            'Bearer realm="mcp", resource_metadata="'
            f'{BASE_URL}{PROTECTED_RESOURCE_METADATA_PATH}"',
        )
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error":"unauthorized"}')

    def send_mcp_result(self, request_id: object, result: dict[str, object]) -> None:
        self.send_json(
            HTTPStatus.OK,
            {"jsonrpc": "2.0", "id": request_id, "result": result},
            extra_headers={"MCP-Session-Id": SESSION_ID},
        )

    def send_mcp_error(self, request_id: object, code: int, message: str) -> None:
        self.send_json(
            HTTPStatus.OK,
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": code, "message": message},
            },
            extra_headers={"MCP-Session-Id": SESSION_ID},
        )

    def send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, object],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status: HTTPStatus, body: str) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def first_value(values: list[str] | None) -> str | None:
    if not values:
        return None
    value = values[0].strip()
    return value or None


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), RemoteMcpFixtureHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
