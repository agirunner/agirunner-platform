#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
import json
from pathlib import Path


LIVE_ROOT = Path(__file__).resolve().parents[1]
LIVE_LIB = LIVE_ROOT / "lib"
SCENARIOS_DIR = LIVE_ROOT / "scenarios"
LIBRARY_DIR = LIVE_ROOT / "library"
sys.path.insert(0, str(LIVE_LIB))

import scenario_config  # noqa: E402


EXPECTED_SCENARIOS = {
    "sdlc-baseline",
    "sdlc-review-rework-once",
    "sdlc-lite-approval-approve",
    "sdlc-lite-approval-request-changes-then-approve",
    "bug-fix-positive",
    "product-requirements-approve",
    "product-requirements-request-changes-then-approve",
    "parallel-burst-ten-work-items",
    "parallel-burst-two-runtimes",
    "sdlc-parallel-validation-positive",
    "host-directory-bug-fix-positive",
}


class LiveTestCatalogTests(unittest.TestCase):
    def test_expected_scenarios_exist(self) -> None:
        actual = {path.stem for path in SCENARIOS_DIR.glob("*.json")}
        self.assertTrue(EXPECTED_SCENARIOS.issubset(actual))

    def test_every_scenario_loads_and_has_profile_fixtures(self) -> None:
        for scenario_file in sorted(SCENARIOS_DIR.glob("*.json")):
            with self.subTest(scenario=scenario_file.stem):
                scenario = scenario_config.load_scenario(scenario_file)
                profile_dir = LIBRARY_DIR / scenario["profile"]
                self.assertTrue(profile_dir.is_dir(), f"missing library profile: {profile_dir}")
                self.assertTrue((profile_dir / "playbook.json").is_file(), "missing playbook fixture")
                self.assertTrue((profile_dir / "roles.json").is_file(), "missing roles fixture")

    def test_live_playbook_fixtures_do_not_override_workspace_storage(self) -> None:
        forbidden_targets = {
            "workspace.repository_url",
            "workspace.settings.default_branch",
        }

        for playbook_file in sorted(LIBRARY_DIR.glob("*/playbook.json")):
            with self.subTest(playbook=playbook_file.parent.name):
                payload = json.loads(playbook_file.read_text())
                parameters = payload.get("definition", {}).get("parameters", [])
                mapped_targets = {
                    parameter.get("maps_to")
                    for parameter in parameters
                    if isinstance(parameter, dict) and parameter.get("maps_to")
                }
                self.assertTrue(
                    forbidden_targets.isdisjoint(mapped_targets),
                    f"{playbook_file} still overrides workspace storage: {sorted(mapped_targets & forbidden_targets)}",
                )


if __name__ == "__main__":
    unittest.main()
