#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import scenario_config  # noqa: E402


class ScenarioConfigTests(unittest.TestCase):
    def write_scenario(self, payload: dict[str, object]) -> Path:
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        with handle:
            json.dump(payload, handle)
        return Path(handle.name)

    def test_load_scenario_applies_defaults_and_uses_file_stem_for_name(self) -> None:
        scenario_path = self.write_scenario(
            {
                "workflow": {
                    "goal": "Exercise the generic runner.",
                }
            }
        )

        scenario = scenario_config.load_scenario(scenario_path)

        self.assertEqual(scenario_path.stem, scenario["name"])
        self.assertEqual(scenario_path.stem, scenario["profile"])
        self.assertEqual(
            {
                "name": scenario_path.stem,
                "goal": "Exercise the generic runner.",
                "parameters": {},
                "metadata": {},
            },
            scenario["workflow"],
        )
        self.assertEqual({"repo": True, "memory": {}, "spec": {}}, scenario["workspace"])
        self.assertEqual([], scenario["approvals"])
        self.assertEqual([], scenario["actions"])
        self.assertEqual({}, scenario["expect"])
        self.assertEqual(1800, scenario["timeout_seconds"])
        self.assertEqual(10, scenario["poll_interval_seconds"])

    def test_load_scenario_preserves_workspace_seed_state_and_expectations(self) -> None:
        scenario_path = self.write_scenario(
            {
                "name": "product-requirements-positive",
                "profile": "product-requirements",
                "workflow": {
                    "name": "Product Requirements Positive",
                    "goal": "Write a PRD artifact and persist the summary to workspace memory.",
                    "parameters": {"feature_request": "Add usage-based billing"},
                    "metadata": {"lane": "artifact"},
                },
                "workspace": {
                    "repo": False,
                    "memory": {"existing_context": "Enterprise admins manage budgets."},
                    "spec": {
                        "documents": {
                            "strategy": {
                                "source": "external",
                                "url": "https://example.test/roadmap",
                            }
                        }
                    },
                },
                "approvals": [
                    {
                        "match": {"stage_name": "approval"},
                        "action": "request_changes",
                        "feedback": "Clarify the pricing alert requirements.",
                    },
                    {
                        "match": {"stage_name": "approval"},
                        "action": "approve",
                    },
                ],
                "actions": [
                    {
                        "type": "create_work_items",
                        "dispatch": "parallel",
                        "count": 3,
                        "title_template": "parallel-burst-{index:02d}",
                        "request_id_template": "burst-{index:02d}",
                    }
                ],
                "expect": {
                    "state": "completed",
                    "memory": [{"key": "prd_summary", "value": "Done"}],
                    "artifacts": [{"logical_path_pattern": "requirements/.*\\.md", "min_count": 1}],
                },
                "timeout_seconds": 900,
                "poll_interval_seconds": 3,
            }
        )

        scenario = scenario_config.load_scenario(scenario_path)

        self.assertEqual("product-requirements-positive", scenario["name"])
        self.assertEqual("product-requirements", scenario["profile"])
        self.assertEqual(False, scenario["workspace"]["repo"])
        self.assertEqual(
            {"existing_context": "Enterprise admins manage budgets."},
            scenario["workspace"]["memory"],
        )
        self.assertEqual(
            {
                "documents": {
                    "strategy": {
                        "source": "external",
                        "url": "https://example.test/roadmap",
                    }
                }
            },
            scenario["workspace"]["spec"],
        )
        self.assertEqual(2, len(scenario["approvals"]))
        self.assertEqual(1, len(scenario["actions"]))
        self.assertEqual("completed", scenario["expect"]["state"])
        self.assertEqual(900, scenario["timeout_seconds"])
        self.assertEqual(3, scenario["poll_interval_seconds"])


if __name__ == "__main__":
    unittest.main()
