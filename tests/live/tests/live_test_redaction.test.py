#!/usr/bin/env python3
from __future__ import annotations

import json
import unittest
from pathlib import Path

import sys


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
if str(LIVE_LIB) not in sys.path:
    sys.path.insert(0, str(LIVE_LIB))

from live_test_redaction import redact_json  # noqa: E402


class LiveTestRedactionTests(unittest.TestCase):
    def test_redact_json_strips_credentials_from_repository_urls_in_nested_values(self) -> None:
        credential_url = (
            "https://x-access-token:secret-token@example.com/org/repo.git?ref=main#readme"
        )

        payload = {
            "repository_url": credential_url,
            "notes": f"Use repository {credential_url} for the run.",
            "nested": {
                "items": [credential_url],
            },
        }

        redacted = redact_json(payload)
        encoded = json.dumps(redacted, sort_keys=True)

        self.assertNotIn("secret-token", encoded)
        self.assertNotIn("x-access-token:", encoded)
        self.assertIn("https://example.com/org/repo.git?ref=main#readme", encoded)


if __name__ == "__main__":
    unittest.main()
