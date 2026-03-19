#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_ROOT = Path(__file__).resolve().parents[1]
LIVE_LIB = LIVE_ROOT / "lib"
SCENARIOS_DIR = LIVE_ROOT / "scenarios"
LIBRARY_DIR = LIVE_ROOT / "library"
sys.path.insert(0, str(LIVE_LIB))

import scenario_config  # noqa: E402


EXPECTED_SCENARIOS = {
    "sdlc-baseline",
    "sdlc-lite-approval-approve",
    "sdlc-lite-approval-request-changes-then-approve",
    "bug-fix-positive",
    "product-requirements-approve",
    "product-requirements-request-changes-then-approve",
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


if __name__ == "__main__":
    unittest.main()
