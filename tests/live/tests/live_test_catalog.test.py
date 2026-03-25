#!/usr/bin/env python3
from __future__ import annotations

import sys
import subprocess
import unittest
from pathlib import Path
import json


LIVE_ROOT = Path(__file__).resolve().parents[1]
LIVE_LIB = LIVE_ROOT / "lib"
SCENARIOS_DIR = LIVE_ROOT / "scenarios"
LIBRARY_DIR = LIVE_ROOT / "library"
README_FILE = LIVE_ROOT / "README.md"
TRACKER_FILE = LIVE_ROOT / "live_test_tracker.json"
sys.path.insert(0, str(LIVE_LIB))

import live_test_catalog  # noqa: E402
import scenario_config  # noqa: E402


class LiveTestCatalogTests(unittest.TestCase):
    def test_tracker_supported_catalog_matches_expected_scenarios(self) -> None:
        tracker = json.loads(TRACKER_FILE.read_text())
        supported = tracker["supported"]["scenarios"]
        self.assertEqual(sorted(live_test_catalog.EXPECTED_SCENARIOS), sorted(supported))
        self.assertEqual(len(supported), tracker["supported"]["total"])

    def test_tracker_starts_with_artifact_memory_publishing(self) -> None:
        tracker = json.loads(TRACKER_FILE.read_text())
        supported = tracker["supported"]["scenarios"]
        self.assertEqual("artifact-memory-publishing-approval", supported[0])

    def test_tracker_policy_describes_guided_closure_outcome_driven_contract(self) -> None:
        tracker = json.loads(TRACKER_FILE.read_text())
        policy = tracker["policy"]
        notes_blob = "\n".join(policy.get("notes", []))

        self.assertEqual("outcome_driven", policy.get("verification_mode"))
        self.assertIn("guided closure", notes_blob.lower())
        self.assertIn("allowed outcome envelope", notes_blob.lower())
        self.assertIn("callout", notes_blob.lower())

    def test_tracker_unsupported_future_design_entries_are_descriptive(self) -> None:
        tracker = json.loads(TRACKER_FILE.read_text())
        deferred = tracker["unsupported_future_design"]
        self.assertEqual(len(deferred["scenarios"]), deferred["total"])
        for entry in deferred["scenarios"]:
            with self.subTest(name=entry.get("name")):
                self.assertIsInstance(entry.get("name"), str)
                self.assertTrue(entry["name"].strip())
                self.assertIsInstance(entry.get("status"), str)
                self.assertTrue(entry["status"].strip())
                self.assertIsInstance(entry.get("reason"), str)
                self.assertTrue(entry["reason"].strip())
                self.assertIsInstance(entry.get("needed_support"), str)
                self.assertTrue(entry["needed_support"].strip())

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

    def test_playbook_fixtures_use_stages_and_no_legacy_governance_config(self) -> None:
        for playbook_file in sorted(LIBRARY_DIR.glob("*/playbook.json")):
            with self.subTest(playbook=playbook_file.parent.name):
                payload = live_test_catalog.read_fixture(playbook_file)
                definition = payload.get("definition", {})
                self.assertTrue(definition.get("process_instructions"))
                self.assertTrue(definition.get("stages"))
                self.assertNotIn("review_rules", definition)
                self.assertNotIn("checkpoints", definition)
                self.assertNotIn("assessment_rules", definition)
                self.assertNotIn("approval_rules", definition)
                self.assertNotIn("handoff_rules", definition)
                self.assertNotIn("branch_policies", definition)

    def test_playbook_process_instructions_are_stage_and_role_specific_with_unhappy_paths(self) -> None:
        for playbook_file in sorted(LIBRARY_DIR.glob("*/playbook.json")):
            with self.subTest(playbook=playbook_file.parent.name):
                payload = live_test_catalog.read_fixture(playbook_file)
                definition = payload.get("definition", {})
                process_instructions = str(definition.get("process_instructions") or "").strip()
                self.assertGreaterEqual(len(process_instructions), 450)
                self.assertGreaterEqual(len([line for line in process_instructions.splitlines() if line.strip()]), 4)
                self.assertIn("If ", process_instructions)
                self.assertIn("Do not", process_instructions)
                self.assertTrue(
                    any(token in process_instructions for token in ("rework", "request changes", "reject", "block", "escalat")),
                    "process instructions must describe at least one unhappy path",
                )

                role_names = [
                    str(role.get("name") or "").strip()
                    for role in live_test_catalog.read_fixture(playbook_file.parent / "roles.json")
                    if str(role.get("name") or "").strip()
                ]
                stage_names = [
                    str(stage.get("name") or "").strip()
                    for stage in definition.get("stages", [])
                    if str(stage.get("name") or "").strip()
                ]
                for role_name in role_names:
                    self.assertIn(role_name, process_instructions)
                for stage_name in stage_names:
                    self.assertIn(stage_name, process_instructions)

    def test_playbook_process_instructions_author_guided_closure_rules(self) -> None:
        for playbook_file in sorted(LIBRARY_DIR.glob("*/playbook.json")):
            with self.subTest(playbook=playbook_file.parent.name):
                payload = live_test_catalog.read_fixture(playbook_file)
                process_instructions = str(payload.get("definition", {}).get("process_instructions") or "")
                normalized = process_instructions.lower()

                self.assertTrue("best-intent" in normalized or "best intent" in normalized)
                self.assertIn("preferred", normalized)
                self.assertTrue("waive" in normalized or "waived" in normalized)
                self.assertIn("block", normalized)
                self.assertIn("callout", normalized)

    def test_scenarios_author_outcome_envelopes_instead_of_relying_on_exact_path_only(self) -> None:
        for scenario_file in sorted(SCENARIOS_DIR.glob("*.json")):
            with self.subTest(scenario=scenario_file.stem):
                payload = live_test_catalog.read_fixture(scenario_file)
                expect = payload.get("expect", {})
                self.assertIsInstance(expect.get("outcome_envelope"), dict)
                envelope = expect["outcome_envelope"]
                self.assertIsInstance(envelope.get("allowed_states"), list)
                self.assertTrue(envelope["allowed_states"])
                self.assertIn("require_output_artifacts", envelope)
                self.assertIn("require_completed_non_orchestrator_tasks", envelope)
                self.assertIn("require_terminal_work_items", envelope)
                self.assertIn("require_db_state", envelope)
                self.assertIn("require_runtime_cleanup", envelope)
                self.assertIn("require_fatal_log_free", envelope)

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
        workspace_instructions = scenario["workspace"]["spec"]["instructions"]["content"]
        self.assertIn("Revision 1 MUST stop at `initial_revision_scope`", workspace_instructions)
        self.assertIn("Do not satisfy any requirement that appears only in `rework_completion_scope`", workspace_instructions)

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
        self.assertIn("MUST NOT implement any item that appears only in the rework_completion_scope", implementation_prompt)
        self.assertIn("first subject revision MUST return request_changes", assessor_prompt)
        self.assertIn("still misses items from the rework_completion_scope", assessor_prompt)
        self.assertIn("Approve only after the subject revision increases", assessor_prompt)
        self.assertIn("resolve every cited finding", implementation_prompt)
        self.assertIn("before resubmitting", implementation_prompt)

    def test_assessment_race_profile_requires_explicit_work_item_and_workflow_completion_prose(self) -> None:
        playbook = live_test_catalog.read_fixture(
            LIBRARY_DIR / "assessment-race" / "playbook.json"
        )
        process_instructions = playbook["definition"]["process_instructions"]

        self.assertIn("both assessor roles", process_instructions)
        self.assertIn("all four race-case work items", process_instructions)
        self.assertIn("keep that race-case open until both assessor roles", process_instructions.lower())

    def test_parallel_mixed_outcomes_profile_authors_a_real_three_revision_contract(self) -> None:
        scenario = scenario_config.load_scenario(
            SCENARIOS_DIR / "sdlc-parallel-assessors-mixed-outcomes.json"
        )
        self.assertEqual(3600, scenario["timeout_seconds"])
        self.assertIn("release-audit", scenario["workflow"]["goal"])

        parameters = scenario["workflow"]["parameters"]
        self.assertIn("initial_revision_scope", parameters)
        self.assertIn("quality_rework_scope", parameters)
        self.assertIn("security_rework_scope", parameters)
        self.assertIn("mixed_outcome_contract", parameters)

        staged_contract = (
            LIBRARY_DIR
            / "sdlc-parallel-assessors-mixed-outcomes"
            / "repo-seed"
            / "docs"
            / "staged-delivery.md"
        )
        self.assertTrue(staged_contract.is_file())
        staged_contract_text = staged_contract.read_text()
        self.assertIn("Revision 1", staged_contract_text)
        self.assertIn("Revision 2 After Quality Request Changes", staged_contract_text)
        self.assertIn("Revision 3 After Security Rejection", staged_contract_text)
        self.assertIn("release-audit", staged_contract_text)

        workspace_instructions = scenario["workspace"]["spec"]["instructions"]["content"]
        self.assertIn("Revision 1 MUST stop at `initial_revision_scope`", workspace_instructions)
        self.assertIn("Revision 2 MUST satisfy `quality_rework_scope`", workspace_instructions)
        self.assertIn("Revision 2 MUST NOT satisfy `security_rework_scope`", workspace_instructions)
        self.assertIn("Revision 3 MUST satisfy the full `security_rework_scope`", workspace_instructions)

        playbook = live_test_catalog.read_fixture(
            LIBRARY_DIR / "sdlc-parallel-assessors-mixed-outcomes" / "playbook.json"
        )
        parameter_names = {entry["name"] for entry in playbook["definition"]["parameters"]}
        self.assertIn("initial_revision_scope", parameter_names)
        self.assertIn("quality_rework_scope", parameter_names)
        self.assertIn("security_rework_scope", parameter_names)
        self.assertIn("mixed_outcome_contract", parameter_names)

        process_instructions = playbook["definition"]["process_instructions"]
        self.assertIn("must not simulate future revisions", process_instructions)
        self.assertIn("both evaluate the same repository-backed subject revision in parallel", process_instructions)
        self.assertNotIn("assessment_rules", playbook["definition"])

        roles = live_test_catalog.read_fixture(
            LIBRARY_DIR / "sdlc-parallel-assessors-mixed-outcomes" / "roles.json"
        )
        architect_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "mixed-architecture-lead"
        )
        implementation_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "mixed-delivery-engineer"
        )
        quality_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "mixed-quality-assessor"
        )
        security_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "mixed-security-assessor"
        )

        self.assertIn("three-revision contract", architect_prompt)
        self.assertIn("Do not preemptively implement revision-3-only security hardening in revision 2", implementation_prompt)
        self.assertIn("Do not build a simulator of later revisions", implementation_prompt)
        self.assertIn("first subject revision MUST return request_changes", quality_prompt)
        self.assertIn("Approve revision 1", security_prompt)
        self.assertIn("Reject revision 2", security_prompt)
        self.assertIn("Approve only after revision 3", security_prompt)

    def test_revision_rework_profile_authors_a_real_three_revision_contract(self) -> None:
        scenario = scenario_config.load_scenario(
            SCENARIOS_DIR / "sdlc-rework-invalidates-prior-assessments.json"
        )
        parameters = scenario["workflow"]["parameters"]
        self.assertIn("initial_revision_scope", parameters)
        self.assertIn("architect_rework_scope", parameters)
        self.assertIn("final_revision_scope", parameters)
        self.assertIn("revision_progression_contract", parameters)

        staged_contract = (
            LIBRARY_DIR
            / "sdlc-revision-rework"
            / "repo-seed"
            / "docs"
            / "staged-revision-contract.md"
        )
        self.assertTrue(staged_contract.is_file())
        staged_contract_text = staged_contract.read_text()
        self.assertIn("Revision 1", staged_contract_text)
        self.assertIn("Revision 2 After Architect Rework", staged_contract_text)
        self.assertIn("Revision 3 Final Implementation", staged_contract_text)

        workspace_instructions = scenario["workspace"]["spec"]["instructions"]["content"]
        self.assertIn("Revision 1 MUST stop at `initial_revision_scope`", workspace_instructions)
        self.assertIn("Revision 2 MUST satisfy `architect_rework_scope`", workspace_instructions)
        self.assertIn("Revision 2 MUST NOT satisfy `final_revision_scope`", workspace_instructions)
        self.assertIn("Revision 3 MUST satisfy the full `final_revision_scope`", workspace_instructions)

        playbook = live_test_catalog.read_fixture(
            LIBRARY_DIR / "sdlc-revision-rework" / "playbook.json"
        )
        parameter_names = {entry["name"] for entry in playbook["definition"]["parameters"]}
        self.assertIn("initial_revision_scope", parameter_names)
        self.assertIn("architect_rework_scope", parameter_names)
        self.assertIn("final_revision_scope", parameter_names)
        self.assertIn("revision_progression_contract", parameter_names)

        process_instructions = playbook["definition"]["process_instructions"]
        self.assertIn("drives the initial reopen_subject rework", process_instructions)
        self.assertIn("routes the revision back to the platform architect", process_instructions)
        self.assertIn("must reassess later release-readiness output", process_instructions)
        self.assertNotIn("assessment_rules", playbook["definition"])

        roles = live_test_catalog.read_fixture(
            LIBRARY_DIR / "sdlc-revision-rework" / "roles.json"
        )
        architect_prompt = next(
            role["systemPrompt"] for role in roles if role["name"] == "platform-architect"
        )
        implementation_prompt = next(
            role["systemPrompt"] for role in roles if role["name"] == "feature-engineer"
        )
        quality_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "integration-quality-assessor"
        )
        integration_prompt = next(
            role["systemPrompt"]
            for role in roles
            if role["name"] == "integration-assessor"
        )

        self.assertIn("three-revision contract", architect_prompt)
        self.assertIn("Revision 1 MUST stop at initial_revision_scope", implementation_prompt)
        self.assertIn("Revision 2 MUST satisfy architect_rework_scope", implementation_prompt)
        self.assertIn("Revision 2 MUST NOT satisfy final_revision_scope", implementation_prompt)
        self.assertIn("Revision 3 MUST satisfy the full final_revision_scope", implementation_prompt)
        self.assertIn("Do not satisfy future revision work early", implementation_prompt)
        self.assertIn("request_changes on revision 1", quality_prompt)
        self.assertIn("approve revisions 2 and 3", quality_prompt)
        self.assertIn("approve revision 1", integration_prompt)
        self.assertIn("reject revision 2", integration_prompt)
        self.assertIn("approve only after revision 3", integration_prompt)

    def test_readme_documents_oauth_default_and_provider_auth_externalization(self) -> None:
        source = README_FILE.read_text()
        self.assertIn("OAuth MUST be the default live-test path.", source)
        self.assertIn("Provider and auth configuration MUST stay externalized", source)
        self.assertIn("The same scenario corpus MUST run against any supported provider/auth combination", source)


if __name__ == "__main__":
    unittest.main()
