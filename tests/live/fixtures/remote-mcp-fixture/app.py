#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable
from urllib.parse import parse_qs, urlparse

from fixture_state import record_invocation, snapshot_invocations
from research_fixture import fetch_research_document, search_research_corpus


HOST = "0.0.0.0"
PORT = int(os.environ.get("FIXTURE_PORT", "18080"))
BASE_URL = os.environ.get("FIXTURE_BASE_URL", f"http://live-test-remote-mcp-fixture:{PORT}").rstrip("/")
CLIENT_ID = os.environ.get("FIXTURE_CLIENT_ID", "live-test-client")
CLIENT_SECRET = os.environ.get("FIXTURE_CLIENT_SECRET", "live-test-secret")
ACCESS_TOKEN = os.environ.get("FIXTURE_ACCESS_TOKEN", "live-test-access-token")
PARAMETERIZED_SECRET = os.environ.get(
    "FIXTURE_PARAMETERIZED_SECRET",
    "live-test-parameterized-secret",
)
SESSION_ID = "live-test-session"
PROTOCOL_VERSION = "2025-03-26"

ADMIN_INVOCATIONS_PATH = "/__admin/invocations"
OAUTH_MCP_ENDPOINT = "/mcp/client-credentials"
PARAMETERIZED_MCP_ENDPOINT = "/mcp/parameterized"
PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp/client-credentials"
AUTHORIZATION_SERVER_PATH = "/oauth/client-credentials"
AUTHORIZATION_SERVER_METADATA_PATH = "/oauth/client-credentials/.well-known/oauth-authorization-server"
OPENID_METADATA_PATH = "/oauth/client-credentials/.well-known/openid-configuration"
TOKEN_PATH = "/oauth/client-credentials/token"
OAUTH_DOC_PATH = "/docs/client-credentials"
PARAMETERIZED_DOC_PATH = "/docs/parameterized"
OAUTH_TOOL_NAME = "lookup_oauth_reference_answer"
PARAMETERIZED_RESEARCH_TOOL_NAME = "lookup_parameterized_research_answer"
PARAMETERIZED_REPOSITORY_TOOL_NAME = "inspect_fixture_repository"
RESEARCH_SEARCH_TOOL_NAME = "search_web"
RESEARCH_FETCH_TOOL_NAME = "fetch_page"


class RemoteMcpFixtureHandler(BaseHTTPRequestHandler):
    server_version = "LiveTestRemoteMcpFixture/1.0"

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            self.send_text(HTTPStatus.OK, "ok\n")
            return
        if path == ADMIN_INVOCATIONS_PATH:
            self.send_json(HTTPStatus.OK, snapshot_invocations())
            return
        if path == OAUTH_DOC_PATH:
            self.send_text(
                HTTPStatus.OK,
                "OAuth client-credentials MCP fixture. Reference answer: Victoria.\n",
            )
            return
        if path == PARAMETERIZED_DOC_PATH:
            self.send_text(
                HTTPStatus.OK,
                (
                    "Parameterized MCP fixture. Research answer: Edmonton. "
                    "Repository fixture: fixture-docs.\n"
                ),
            )
            return
        if path == OAUTH_MCP_ENDPOINT:
            self.send_unauthorized_challenge()
            return
        if path in {PROTECTED_RESOURCE_METADATA_PATH, f"{OAUTH_MCP_ENDPOINT}/.well-known/oauth-protected-resource"}:
            self.send_json(
                HTTPStatus.OK,
                {
                    "resource": f"{BASE_URL}{OAUTH_MCP_ENDPOINT}",
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
        if path == OAUTH_MCP_ENDPOINT:
            self.handle_mcp_request(
                endpoint=OAUTH_MCP_ENDPOINT,
                auth_mode="oauth_client_credentials",
                tools=[
                    {
                        "name": OAUTH_TOOL_NAME,
                        "description": "Return the deterministic OAuth-backed reference answer.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"topic": {"type": "string"}},
                            "required": ["topic"],
                            "additionalProperties": False,
                        },
                    }
                ],
                tool_handlers={
                    OAUTH_TOOL_NAME: self.handle_oauth_reference_answer,
                },
            )
            return
        if path == PARAMETERIZED_MCP_ENDPOINT:
            self.handle_mcp_request(
                endpoint=PARAMETERIZED_MCP_ENDPOINT,
                auth_mode="parameterized_secret",
                tools=[
                    {
                        "name": PARAMETERIZED_RESEARCH_TOOL_NAME,
                        "description": "Return the deterministic parameterized research answer.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"topic": {"type": "string"}},
                            "required": ["topic"],
                            "additionalProperties": False,
                        },
                    },
                    {
                        "name": PARAMETERIZED_REPOSITORY_TOOL_NAME,
                        "description": "Return deterministic repository metadata for the fixture repository.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"repository": {"type": "string"}},
                            "required": ["repository"],
                            "additionalProperties": False,
                        },
                    },
                    {
                        "name": RESEARCH_SEARCH_TOOL_NAME,
                        "description": "Return deterministic Tavily/Exa-style research results from a realistic fixture corpus.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}},
                            "required": ["query"],
                            "additionalProperties": False,
                        },
                    },
                    {
                        "name": RESEARCH_FETCH_TOOL_NAME,
                        "description": "Fetch the full body for a deterministic research result URL.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"url": {"type": "string"}},
                            "required": ["url"],
                            "additionalProperties": False,
                        },
                    },
                ],
                tool_handlers={
                    PARAMETERIZED_RESEARCH_TOOL_NAME: self.handle_parameterized_research_answer,
                    PARAMETERIZED_REPOSITORY_TOOL_NAME: self.handle_parameterized_repository_metadata,
                    RESEARCH_SEARCH_TOOL_NAME: self.handle_research_search,
                    RESEARCH_FETCH_TOOL_NAME: self.handle_research_fetch,
                },
            )
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {OAUTH_MCP_ENDPOINT, PARAMETERIZED_MCP_ENDPOINT}:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return

    def handle_token_exchange(self) -> None:
        params = self.read_form_payload()
        client_id, client_secret = self.read_client_credentials(params)
        record_invocation(
            "token_exchange",
            TOKEN_PATH,
            auth_mode="oauth_client_credentials",
            grant_type=first_value(params.get("grant_type")),
            accepted=client_id == CLIENT_ID and client_secret == CLIENT_SECRET,
        )
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

    def handle_mcp_request(
        self,
        *,
        endpoint: str,
        auth_mode: str,
        tools: list[dict[str, object]],
        tool_handlers: dict[str, Callable[[dict[str, object]], dict[str, object]]],
    ) -> None:
        if auth_mode == "oauth_client_credentials":
            if not self.has_valid_authorization():
                self.send_unauthorized_challenge()
                return
        elif not self.has_valid_parameterized_key():
            self.send_parameterized_unauthorized()
            return
        request = self.read_json_payload()
        request_id = request.get("id")
        method = str(request.get("method") or "").strip()
        params = request.get("params") if isinstance(request.get("params"), dict) else {}

        if method == "initialize":
            record_invocation("initialize", endpoint, auth_mode=auth_mode)
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
            record_invocation("tools_list", endpoint, auth_mode=auth_mode)
            self.send_mcp_result(request_id, {"tools": tools})
            return
        if method == "tools/call":
            requested_tool_name = str(params.get("name") or "").strip()
            arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
            tool_handler = tool_handlers.get(requested_tool_name)
            if tool_handler is None:
                self.send_mcp_error(request_id, -32601, f"Unknown tool {requested_tool_name!r}")
                return
            record_invocation(
                "tool_call",
                endpoint,
                auth_mode=auth_mode,
                tool_name=requested_tool_name,
                arguments=arguments,
            )
            self.send_mcp_result(request_id, tool_handler(arguments))
            return
        self.send_mcp_error(request_id, -32601, f"Unsupported method {method!r}")

    def handle_oauth_reference_answer(self, arguments: dict[str, object]) -> dict[str, object]:
        topic = str(arguments.get("topic") or "British Columbia capital").strip()
        return {
            "answer": "Victoria",
            "answer_line": "Answer: Victoria",
            "topic": topic,
            "source_url": f"{BASE_URL}{OAUTH_DOC_PATH}",
        }

    def handle_parameterized_research_answer(self, arguments: dict[str, object]) -> dict[str, object]:
        topic = str(arguments.get("topic") or "Alberta capital").strip()
        return {
            "answer": "Edmonton",
            "answer_line": "Answer: Edmonton",
            "topic": topic,
            "source_url": f"{BASE_URL}{PARAMETERIZED_DOC_PATH}",
        }

    def handle_parameterized_repository_metadata(self, arguments: dict[str, object]) -> dict[str, object]:
        repository = str(arguments.get("repository") or "fixture-docs").strip()
        return {
            "repository": repository,
            "default_branch": "main",
            "readme_present": True,
            "repository_line": f"Repository: {repository}",
            "branch_line": "Default branch: main",
            "readme_line": "README present: yes",
            "source_url": f"{BASE_URL}{PARAMETERIZED_DOC_PATH}",
        }

    def handle_research_search(self, arguments: dict[str, object]) -> dict[str, object]:
        query = str(arguments.get("query") or "").strip()
        limit = int(arguments.get("limit") or 5)
        return {
            "query": query,
            "results": search_research_corpus(query, limit=limit),
            "source": "fixture_research_library",
        }

    def handle_research_fetch(self, arguments: dict[str, object]) -> dict[str, object]:
        url = str(arguments.get("url") or "").strip()
        return fetch_research_document(url)

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

    def has_valid_parameterized_key(self) -> bool:
        return self.headers.get("X-Fixture-Key", "").strip() == PARAMETERIZED_SECRET

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

    def send_parameterized_unauthorized(self) -> None:
        self.send_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": "unauthorized", "error_description": "X-Fixture-Key is required"},
        )

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
