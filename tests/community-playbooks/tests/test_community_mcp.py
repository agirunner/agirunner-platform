#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path
import sys
from unittest.mock import patch


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from community_mcp import COMMUNITY_MCP_FIXTURE, configure_community_mcp_servers


class CommunityMcpTests(unittest.TestCase):
    def test_configure_community_mcp_servers_uses_suite_fixture_by_default(self) -> None:
        fake_client = object()
        with patch(
            "community_mcp.sync_remote_mcp_servers",
            return_value={"items": [{"slug": "community-research-mcp"}], "by_slug": {}},
        ) as sync_mock:
            result = configure_community_mcp_servers(fake_client)

        sync_mock.assert_called_once_with(fake_client, COMMUNITY_MCP_FIXTURE)
        self.assertEqual("community-research-mcp", result["items"][0]["slug"])


if __name__ == "__main__":
    unittest.main()
