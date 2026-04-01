#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from common import read_json_file, write_json_file  # noqa: E402


class CommonResultsRedactionTests(unittest.TestCase):
    def test_write_json_file_redacts_credential_bearing_repository_urls(self) -> None:
        credential_url = "https://x-access-token:secret-token@example.com/org/repo.git"

        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "result.json"
            write_json_file(
                target,
                {
                    "repository_url": credential_url,
                    "notes": f"Repository: {credential_url}",
                },
            )

            payload = read_json_file(target)
            encoded = target.read_text(encoding="utf-8")

            self.assertEqual("https://example.com/org/repo.git", payload["repository_url"])
            self.assertIn("https://example.com/org/repo.git", payload["notes"])
            self.assertNotIn("secret-token", encoded)
            self.assertNotIn("x-access-token:", encoded)


if __name__ == "__main__":
    unittest.main()
