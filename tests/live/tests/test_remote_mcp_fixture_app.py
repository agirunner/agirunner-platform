#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path
import sys


FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "remote-mcp-fixture"
if str(FIXTURE_ROOT) not in sys.path:
    sys.path.insert(0, str(FIXTURE_ROOT))

from app import fetch_research_document, search_research_corpus


class RemoteMcpFixtureAppTests(unittest.TestCase):
    def test_search_research_corpus_returns_fixture_results_with_metadata(self) -> None:
        results = search_research_corpus("audit export reliability operator workflow", limit=3)

        self.assertGreaterEqual(len(results), 1)
        self.assertTrue(str(results[0]["title"]).strip())
        self.assertEqual("Fixture Research Library", results[0]["source"])
        self.assertTrue(str(results[0]["url"]).startswith("https://fixtures.local/research/"))

    def test_fetch_research_document_returns_full_fixture_body(self) -> None:
        payload = fetch_research_document("https://fixtures.local/research/research-operations-cost-model")

        self.assertTrue(payload["found"])
        self.assertIn("integration effort", payload["content"])
        self.assertEqual("Fixture Research Library", payload["source"])


if __name__ == "__main__":
    unittest.main()
