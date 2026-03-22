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


if __name__ == "__main__":
    unittest.main()
