#!/usr/bin/env python3
from __future__ import annotations

import sys
import subprocess
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

    def test_sdlc_single_assessment_profile_seeds_a_real_repo_and_verification_path(self) -> None:
        seed_root = LIBRARY_DIR / "sdlc-assessment-approve" / "repo-seed"
        self.assertTrue((seed_root / "README.md").is_file())
        self.assertTrue((seed_root / "workflow_cli" / "__main__.py").is_file())
        self.assertTrue((seed_root / "scripts" / "verify.sh").is_file())
        self.assertTrue((seed_root / "tests" / "test_cli.py").is_file())

    def test_repo_backed_profiles_provide_seed_content_for_their_storage_mode(self) -> None:
        for scenario_file in sorted(SCENARIOS_DIR.glob("*.json")):
            with self.subTest(scenario=scenario_file.stem):
                scenario = scenario_config.load_scenario(scenario_file)
                profile_dir = LIBRARY_DIR / scenario["profile"]
                storage_type = scenario["workspace"]["storage"]["type"]
                if storage_type == "git_remote":
                    seed_root = profile_dir / "repo-seed"
                    self.assertTrue(seed_root.is_dir(), f"missing repo seed for {scenario['profile']}")
                    self.assertTrue((seed_root / "README.md").is_file(), "missing seed README")
                    self.assertTrue((seed_root / "scripts" / "verify.sh").is_file(), "missing seed verify script")
                elif storage_type == "host_directory":
                    seed_root = profile_dir / "host-seed"
                    self.assertTrue(seed_root.is_dir(), f"missing host seed for {scenario['profile']}")
                    self.assertTrue((seed_root / "README.md").is_file(), "missing host seed README")
                    self.assertTrue((seed_root / "scripts" / "verify.sh").is_file(), "missing host seed verify script")

    def test_workspace_spec_instruction_documents_match_api_shape(self) -> None:
        for scenario_file in sorted(SCENARIOS_DIR.glob("*.json")):
            with self.subTest(scenario=scenario_file.stem):
                scenario = scenario_config.load_scenario(scenario_file)
                instructions = scenario["workspace"]["spec"].get("instructions")
                if instructions is None:
                    continue
                self.assertIsInstance(instructions, dict)
                self.assertIsInstance(instructions.get("content"), str)

    def test_library_fixtures_do_not_include_generated_python_cache_files(self) -> None:
        tracked = subprocess.run(
            ["git", "-C", str(LIVE_ROOT.parents[1]), "ls-files", str(LIBRARY_DIR)],
            check=True,
            capture_output=True,
            text=True,
        )
        generated = sorted(
            path for path in tracked.stdout.splitlines() if "__pycache__" in path or path.endswith(".pyc")
        )
        self.assertEqual([], generated)

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

    def test_each_scenario_uses_a_dedicated_profile(self) -> None:
        scenarios_by_profile: dict[str, list[str]] = {}
        for scenario_file in sorted(SCENARIOS_DIR.glob("*.json")):
            scenario = scenario_config.load_scenario(scenario_file)
            scenarios_by_profile.setdefault(scenario["profile"], []).append(scenario_file.stem)

        shared_profiles = {
            profile_name: scenario_names
            for profile_name, scenario_names in scenarios_by_profile.items()
            if len(scenario_names) > 1
        }
        self.assertEqual({}, shared_profiles)

    def test_request_changes_once_profile_requires_a_real_first_revision_rework_cycle(self) -> None:
        scenario = scenario_config.load_scenario(
            SCENARIOS_DIR / "sdlc-assessment-request-changes-once.json"
        )
        parameters = scenario["workflow"]["parameters"]
        self.assertIn("scenario_name", parameters)
        self.assertIn("initial_revision_scope", parameters)
        self.assertIn("rework_completion_scope", parameters)

        playbook = live_test_catalog.read_fixture(
            LIBRARY_DIR / "sdlc-assessment-request-changes-once" / "playbook.json"
        )
        parameter_names = {
            entry["name"] for entry in playbook["definition"]["parameters"]
        }
        self.assertIn("initial_revision_scope", parameter_names)
        self.assertIn("rework_completion_scope", parameter_names)

        roles = live_test_catalog.read_fixture(
            LIBRARY_DIR / "sdlc-assessment-request-changes-once" / "roles.json"
        )
        assessor_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "rework-acceptance-assessor"
        )
        implementation_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "rework-implementation-engineer"
        )

        self.assertIn("satisfy the authored initial_revision_scope and stop there", implementation_prompt)
        self.assertIn("satisfy the full rework_completion_scope", implementation_prompt)
        self.assertIn("first subject revision MUST return request_changes", assessor_prompt)
        self.assertIn("still misses items from the rework_completion_scope", assessor_prompt)
        self.assertIn("Approve only after the subject revision increases", assessor_prompt)
        self.assertIn("resolve every cited finding", implementation_prompt)
        self.assertIn("before resubmitting", implementation_prompt)

    def test_readme_documents_oauth_default_and_provider_auth_externalization(self) -> None:
        source = README_FILE.read_text()
        self.assertIn("OAuth MUST be the default live-test path.", source)
        self.assertIn("Provider and auth configuration MUST stay externalized", source)
        self.assertIn("The same scenario corpus MUST run against any supported provider/auth combination", source)


if __name__ == "__main__":
    unittest.main()
