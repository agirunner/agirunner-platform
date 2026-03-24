import json
import subprocess
import sys
import unittest


class WorkflowCliTests(unittest.TestCase):
    def test_status_command_emits_stable_json(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "workflow_cli", "status"],
            check=True,
            capture_output=True,
            text=True,
        )

        payload = json.loads(completed.stdout)
        self.assertEqual(
            {"service": "workflow-cli", "status": "ready"},
            payload,
        )

    def test_status_report_command_is_not_implemented_yet(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "workflow_cli", "status-report", "--scenario-name", "runtime-task-sandbox-split"],
            capture_output=True,
            text=True,
        )

        self.assertNotEqual(0, completed.returncode)


if __name__ == "__main__":
    unittest.main()
