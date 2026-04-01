#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from common import LIVE_LIB, relative_to_suite

if str(LIVE_LIB) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(LIVE_LIB))

from remote_mcp_fixture_sync import sync_remote_mcp_servers


COMMUNITY_MCP_FIXTURE = relative_to_suite("fixtures/remote-mcp-servers.json")


def configure_community_mcp_servers(client: Any, fixture_path: str | Path | None = None) -> dict[str, Any]:
    return sync_remote_mcp_servers(client, Path(fixture_path or COMMUNITY_MCP_FIXTURE))
