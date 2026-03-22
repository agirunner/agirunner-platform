#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_ROOT = Path(__file__).resolve().parents[1]
LIVE_LIB = LIVE_ROOT / "lib"
SCENARIOS_DIR = LIVE_ROOT / "scenarios"
LIBRARY_DIR = LIVE_ROOT / "library"
README_FILE = LIVE_ROOT / "README.md"
sys.path.insert(0, str(LIVE_LIB))

import live_test_catalog  # noqa: E402
import scenario_config  # noqa: E402


class LiveTestCatalogTests(unittest.TestCase):
    def test_expected_matrix_scenarios_exist_and_legacy_corpus_is_gone(self) -> None:
        actual = {path.stem for path in SCENARIOS_DIR.glob("*.json")}
        self.assertEqual(live_test_catalog.EXPECTED_SCENARIOS, actual)

    def test_every_scenario_loads_has_profile_fixtures_and_declares_coverage(self) -> None:
        for scenario_file in sorted(SCENARIOS_DIR.glob("*.json")):
            with self.subTest(scenario=scenario_file.stem):
                scenario = scenario_config.load_scenario(scenario_file)
                profile_dir = LIBRARY_DIR / scenario["profile"]
                self.assertTrue(profile_dir.is_dir(), f"missing library profile: {profile_dir}")
                self.assertTrue((profile_dir / "playbook.json").is_file(), "missing playbook fixture")
                self.assertTrue((profile_dir / "roles.json").is_file(), "missing roles fixture")
                self.assertTrue(scenario["coverage"], "scenario must declare coverage metadata")

    def test_coverage_union_matches_required_matrix(self) -> None:
        coverage_union = live_test_catalog.collect_coverage_union(SCENARIOS_DIR)
        self.assertEqual(live_test_catalog.REQUIRED_COVERAGE, coverage_union)

    def test_scenarios_do_not_embed_provider_or_auth_overrides(self) -> None:
        for scenario_file in sorted(SCENARIOS_DIR.glob("*.json")):
            with self.subTest(scenario=scenario_file.stem):
                scenario = scenario_config.load_scenario(scenario_file)
                self.assertNotIn("provider", scenario)
                self.assertNotIn("auth", scenario)
                self.assertNotIn("models", scenario)

    def test_playbook_fixtures_use_assessment_rules_and_no_review_rules(self) -> None:
        for playbook_file in sorted(LIBRARY_DIR.glob("*/playbook.json")):
            with self.subTest(playbook=playbook_file.parent.name):
                payload = live_test_catalog.read_fixture(playbook_file)
                definition = payload.get("definition", {})
                self.assertNotIn("review_rules", definition)
                self.assertIn("assessment_rules", definition)

    def test_profiles_do_not_reuse_role_names(self) -> None:
        owners_by_role: dict[str, set[str]] = {}
        for roles_file in sorted(LIBRARY_DIR.glob("*/roles.json")):
            profile_name = roles_file.parent.name
            payload = live_test_catalog.read_fixture(roles_file)
            for role in payload:
                role_name = str(role.get("name") or "").strip()
                self.assertTrue(role_name, f"{roles_file} contains an empty role name")
                owners_by_role.setdefault(role_name, set()).add(profile_name)

        duplicates = {
            role_name: sorted(owners)
            for role_name, owners in owners_by_role.items()
            if len(owners) > 1
        }
        self.assertEqual({}, duplicates)

    def test_readme_documents_oauth_default_and_provider_auth_externalization(self) -> None:
        source = README_FILE.read_text()
        self.assertIn("OAuth MUST be the default live-test path.", source)
        self.assertIn("Provider and auth configuration MUST stay externalized", source)
        self.assertIn("The same scenario corpus MUST run against any supported provider/auth combination", source)


if __name__ == "__main__":
    unittest.main()
