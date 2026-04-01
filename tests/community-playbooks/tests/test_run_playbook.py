#!/usr/bin/env python3
from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from run_playbook import build_workflow_launch_payload, extract_playbook_launch_inputs


class RunPlaybookTests(unittest.TestCase):
    def test_extract_playbook_launch_inputs_reads_definition_parameters(self) -> None:
        playbook = {
            "definition": {
                "parameters": [
                    {"slug": "issue_summary", "title": "Issue summary", "required": True},
                    {"slug": "acceptance_scope", "title": "Acceptance scope", "required": False},
                ]
            }
        }

        inputs = extract_playbook_launch_inputs(playbook)

        self.assertEqual(
            [
                {"slug": "issue_summary", "title": "Issue summary", "required": True},
                {"slug": "acceptance_scope", "title": "Acceptance scope", "required": False},
            ],
            inputs,
        )

    def test_build_workflow_launch_payload_maps_declared_inputs_and_uploads(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_path = Path(tmpdir) / "bug-report.md"
            upload_path.write_text("timeout details", encoding="utf-8")
            playbook = {
                "id": "playbook-1",
                "name": "Bug Fix",
                "definition": {
                    "parameters": [
                        {"slug": "issue_summary", "title": "Issue summary", "required": True},
                        {"slug": "acceptance_scope", "title": "Acceptance scope", "required": False},
                    ]
                },
            }
            run_spec = {
                "id": "bug-fix-smoke",
                "playbook_slug": "bug-fix",
                "variant": "smoke",
                "launch_inputs": {
                    "issue_summary": "Exports time out at sixty seconds.",
                    "acceptance_scope": "Need a minimal safe fix.",
                    "ignored": "must not leak into payload",
                },
                "uploads": [str(upload_path)],
            }

            payload = build_workflow_launch_payload(playbook, workspace_id="workspace-1", run_spec=run_spec)

            self.assertEqual("playbook-1", payload["playbook_id"])
            self.assertEqual("workspace-1", payload["workspace_id"])
            self.assertEqual(
                {
                    "issue_summary": "Exports time out at sixty seconds.",
                    "acceptance_scope": "Need a minimal safe fix.",
                },
                payload["parameters"],
            )
            self.assertEqual(1, len(payload["initial_input_packet"]["files"]))
            encoded = payload["initial_input_packet"]["files"][0]
            self.assertEqual("bug-report.md", encoded["file_name"])
            self.assertEqual(
                "timeout details",
                base64.b64decode(encoded["content_base64"]).decode("utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
