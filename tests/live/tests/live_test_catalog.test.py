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
    "sdlc-review-reject-twice",
    "sdlc-qa-fails-once",
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

    def test_review_rework_profile_uses_handoff_verdict_not_task_mutation_tool(self) -> None:
        roles_file = LIBRARY_DIR / "sdlc-review-rework-once" / "roles.json"
        payload = json.loads(roles_file.read_text())
        reviewer = next(role for role in payload if role.get("name") == "live-test-reviewer")
        self.assertNotIn(
            "request_rework",
            reviewer.get("allowedTools", []),
            "sdlc-review-rework-once reviewer must not rely on an unavailable task-mutation tool",
        )
        for forbidden_tool in (
            "file_write",
            "file_edit",
            "git_commit",
            "git_push",
            "memory_write",
        ):
            self.assertNotIn(
                forbidden_tool,
                reviewer.get("allowedTools", []),
                f"sdlc-review-rework-once reviewer must stay review-only, not mutate via {forbidden_tool}",
            )
        self.assertIn("orchestrator performs task-state mutations", reviewer.get("systemPrompt", ""))
        self.assertIn("MUST set `resolution` to `request_changes`", reviewer.get("systemPrompt", ""))
        self.assertIn("Do not fix the code yourself", reviewer.get("systemPrompt", ""))

    def test_review_reject_twice_profile_forces_two_request_changes_cycles(self) -> None:
        roles_file = LIBRARY_DIR / "sdlc-review-reject-twice" / "roles.json"
        payload = json.loads(roles_file.read_text())
        reviewer = next(role for role in payload if role.get("name") == "live-test-reviewer")
        self.assertIn("exactly two concrete request-changes review verdicts", reviewer.get("systemPrompt", ""))
        self.assertIn("do not repeat the forced rejection after two real rework cycles", reviewer.get("systemPrompt", ""))

    def test_review_reject_twice_profile_keys_forced_verdicts_to_formal_review_pass_titles(self) -> None:
        roles_file = LIBRARY_DIR / "sdlc-review-reject-twice" / "roles.json"
        playbook_file = LIBRARY_DIR / "sdlc-review-reject-twice" / "playbook.json"

        roles = json.loads(roles_file.read_text())
        playbook = json.loads(playbook_file.read_text())
        reviewer = next(role for role in roles if role.get("name") == "live-test-reviewer")
        combined_contract = "\n".join(
            [
                reviewer.get("systemPrompt", ""),
                playbook.get("definition", {}).get("process_instructions", ""),
                playbook.get("outcome", ""),
            ]
        )
        self.assertIn("First formal review", combined_contract)
        self.assertIn("Second formal review", combined_contract)
        self.assertIn("Third formal review", combined_contract)
        self.assertIn("must return `request_changes`", combined_contract)
        self.assertIn("may approve", combined_contract)

    def test_review_reject_twice_profile_requires_structured_review_findings(self) -> None:
        roles_file = LIBRARY_DIR / "sdlc-review-reject-twice" / "roles.json"
        payload = json.loads(roles_file.read_text())
        reviewer = next(role for role in payload if role.get("name") == "live-test-reviewer")
        developer = next(role for role in payload if role.get("name") == "live-test-developer")

        self.assertIn("remaining_items", reviewer.get("systemPrompt", ""))
        self.assertIn("review_focus", reviewer.get("systemPrompt", ""))
        self.assertIn("Treat predecessor review remaining_items and review_focus as blocking acceptance criteria", developer.get("systemPrompt", ""))

    def test_review_reject_twice_profile_authors_concrete_invalid_option_closure(self) -> None:
        scenario_file = SCENARIOS_DIR / "sdlc-review-reject-twice.json"
        playbook_file = LIBRARY_DIR / "sdlc-review-reject-twice" / "playbook.json"
        roles_file = LIBRARY_DIR / "sdlc-review-reject-twice" / "roles.json"

        scenario = json.loads(scenario_file.read_text())
        playbook = json.loads(playbook_file.read_text())
        roles = json.loads(roles_file.read_text())
        developer = next(role for role in roles if role.get("name") == "live-test-developer")
        reviewer = next(role for role in roles if role.get("name") == "live-test-reviewer")

        authored_snippets = (
            "two distinct unsupported long-option cases",
            "no stdout output",
        )

        content = "\n".join(
            [
                scenario.get("workflow", {}).get("goal", ""),
                playbook.get("definition", {}).get("process_instructions", ""),
                playbook.get("outcome", ""),
                developer.get("systemPrompt", ""),
                reviewer.get("systemPrompt", ""),
            ]
        ).lower()

        for snippet in authored_snippets:
            self.assertIn(
                snippet,
                content,
                f"sdlc-review-reject-twice must author '{snippet}' into the test contract",
            )

    def test_review_reject_twice_profile_aligns_rework_findings_with_authored_scope(self) -> None:
        scenario_file = SCENARIOS_DIR / "sdlc-review-reject-twice.json"
        playbook_file = LIBRARY_DIR / "sdlc-review-reject-twice" / "playbook.json"

        scenario = json.loads(scenario_file.read_text())
        playbook = json.loads(playbook_file.read_text())

        workflow_goal = scenario.get("workflow", {}).get("goal", "")
        process_instructions = playbook.get("definition", {}).get("process_instructions", "")
        outcome = playbook.get("outcome", "")

        expected_scope_snippets = (
            "unsupported",
            "usage",
            "invalid-option",
        )

        for snippet in expected_scope_snippets:
            self.assertIn(
                snippet,
                workflow_goal.lower(),
                f"sdlc-review-reject-twice workflow goal must author '{snippet}' into scope",
            )
            self.assertIn(
                snippet,
                process_instructions.lower(),
                f"sdlc-review-reject-twice process instructions must author '{snippet}' into scope",
            )
            self.assertIn(
                snippet,
                outcome.lower(),
                f"sdlc-review-reject-twice outcome must author '{snippet}' into scope",
            )

    def test_review_reject_twice_profile_sets_realistic_orchestrator_efficiency_budget(self) -> None:
        scenario_file = SCENARIOS_DIR / "sdlc-review-reject-twice.json"
        scenario = json.loads(scenario_file.read_text())
        efficiency = scenario.get("expect", {}).get("efficiency", {})
        self.assertEqual(
            36,
            efficiency.get("orchestrator_max_llm_turns_lte"),
            "sdlc-review-reject-twice should allow enough orchestrator headroom for two full reject-and-reroute cycles",
        )

    def test_qa_fails_once_profile_forces_verification_request_changes_not_reviewer_rejection(self) -> None:
        roles_file = LIBRARY_DIR / "sdlc-qa-fails-once" / "roles.json"
        playbook_file = LIBRARY_DIR / "sdlc-qa-fails-once" / "playbook.json"

        roles = json.loads(roles_file.read_text())
        playbook = json.loads(playbook_file.read_text())
        reviewer = next(role for role in roles if role.get("name") == "live-test-reviewer")
        qa = next(role for role in roles if role.get("name") == "live-test-qa")

        self.assertNotIn("exactly one concrete request-changes review verdict", reviewer.get("systemPrompt", ""))
        self.assertIn("Approve the implementation when it satisfies the authored bar", reviewer.get("systemPrompt", ""))
        self.assertIn("exactly one concrete request-changes verification verdict", qa.get("systemPrompt", ""))
        self.assertIn("MUST set `resolution` to `request_changes`", qa.get("systemPrompt", ""))
        self.assertIn("first verification pass after reviewer approval", playbook.get("definition", {}).get("process_instructions", ""))

    def test_qa_fails_once_profile_keeps_qa_review_only(self) -> None:
        roles_file = LIBRARY_DIR / "sdlc-qa-fails-once" / "roles.json"
        payload = json.loads(roles_file.read_text())
        qa = next(role for role in payload if role.get("name") == "live-test-qa")
        self.assertNotIn("request_rework", qa.get("allowedTools", []))
        for forbidden_tool in (
            "file_write",
            "file_edit",
            "git_commit",
            "git_push",
            "memory_write",
        ):
            self.assertNotIn(
                forbidden_tool,
                qa.get("allowedTools", []),
                f"sdlc-qa-fails-once QA must stay verification-only, not mutate via {forbidden_tool}",
            )
        self.assertIn("Do not fix the code yourself", qa.get("systemPrompt", ""))

    def test_qa_fails_once_profile_proves_verification_child_rework_not_review_child_rework(self) -> None:
        scenario_file = SCENARIOS_DIR / "sdlc-qa-fails-once.json"
        scenario = json.loads(scenario_file.read_text())
        expectations = scenario.get("expect", {})
        sequences = expectations.get("continuity_rework_sequences", [])
        self.assertEqual(1, len(sequences))
        self.assertEqual("implementation", sequences[0].get("stage_name"))
        self.assertEqual("live-test-developer", sequences[0].get("required_role"))
        self.assertEqual("verification", sequences[0].get("review_stage_name"))
        self.assertEqual(2, sequences[0].get("review_task_min_count"))


if __name__ == "__main__":
    unittest.main()
