#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SUITE_ROOT = Path(__file__).resolve().parents[1]
RUNNER = SUITE_ROOT / "run.sh"


class RunWrapperEnvTests(unittest.TestCase):
    def test_wrapper_applies_optional_suite_env_overrides_after_live_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            live_env_file = Path(tmpdir) / "live.env"
            live_env_file.write_text(
                "\n".join(
                    [
                        "PLATFORM_API_PORT=18080",
                        "DASHBOARD_PORT=13000",
                        "LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET=base-secret",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            suite_env_file = Path(tmpdir) / "community.env"
            custom_results_dir = Path(tmpdir) / "community-results"
            suite_env_file.write_text(
                "\n".join(
                    [
                        "DASHBOARD_PORT=13001",
                        "LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET=suite-secret",
                        f"COMMUNITY_PLAYBOOKS_RESULTS_DIR={custom_results_dir}",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            capture_path = Path(tmpdir) / "capture.json"
            python_dir = Path(tmpdir) / "bin"
            python_dir.mkdir()
            fake_python = python_dir / "python3"
            real_python = sys.executable
            fake_python.write_text(
                "\n".join(
                    [
                        f"#!{real_python}",
                        "import json",
                        "import os",
                        f"capture_path = {str(capture_path)!r}",
                        "payload = {",
                        "  'platform_api_base_url': os.environ.get('PLATFORM_API_BASE_URL'),",
                        "  'dashboard_base_url': os.environ.get('DASHBOARD_BASE_URL'),",
                        "  'mcp_secret': os.environ.get('LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET'),",
                        "  'results_dir': os.environ.get('COMMUNITY_PLAYBOOKS_RESULTS_DIR'),",
                        "}",
                        "with open(capture_path, 'w', encoding='utf-8') as handle:",
                        "    json.dump(payload, handle)",
                        "raise SystemExit(0)",
                    ]
                ),
                encoding="utf-8",
            )
            fake_python.chmod(0o755)

            env = os.environ.copy()
            env["LIVE_TEST_ENV_FILE"] = str(live_env_file)
            env["COMMUNITY_PLAYBOOKS_ENV_FILE"] = str(suite_env_file)
            env["PATH"] = f"{python_dir}:{env.get('PATH', '')}"

            completed = subprocess.run(
                ["bash", str(RUNNER), "--playbook", "bug-fix"],
                cwd=SUITE_ROOT.parents[2],
                check=False,
                text=True,
                capture_output=True,
                env=env,
            )

            self.assertEqual(0, completed.returncode, completed.stderr)
            payload = json.loads(capture_path.read_text(encoding="utf-8"))
            self.assertEqual(
                {
                    "platform_api_base_url": "http://127.0.0.1:18080",
                    "dashboard_base_url": "http://127.0.0.1:13001",
                    "mcp_secret": "suite-secret",
                    "results_dir": str(custom_results_dir),
                },
                payload,
            )


if __name__ == "__main__":
    unittest.main()
