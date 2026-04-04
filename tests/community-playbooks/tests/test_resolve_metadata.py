#!/usr/bin/env python3
from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from resolve_metadata import METADATA_FILE, load_metadata, resolve_run_specs, validate_metadata


class ResolveMetadataTests(unittest.TestCase):
    def test_current_metadata_has_expected_smoke_coverage_for_supported_first_party_playbooks(self) -> None:
        metadata = load_metadata(str(METADATA_FILE))

        validate_metadata(metadata)

        smoke_playbooks = {
            str(run["playbook_slug"])
            for run in metadata["runs"]
            if isinstance(run, dict) and str(run.get("batch") or "") == "smoke"
        }
        self.assertEqual(
            {
                "account-discovery",
                "api-documentation",
                "bug-fix",
                "business-case",
                "code-review",
                "content-pipeline",
                "contract-review",
                "customer-support-triage",
                "deep-research-pipeline",
                "hotfix",
                "market-map",
                "policy-review",
                "pr-guardian",
                "prospect-search",
                "regression-monitor",
                "research-analysis",
                "research-brief-to-report",
                "runbook-creation",
                "search-discovery",
                "sop-creation",
                "technical-documentation",
                "vendor-evaluation",
            },
            smoke_playbooks,
        )

    def test_resolve_run_specs_supports_new_research_smoke_variants(self) -> None:
        metadata = load_metadata(str(METADATA_FILE))
        validate_metadata(metadata)

        expected_inputs = {
            "account-discovery": {"account_name", "qualification_goal", "search_constraints"},
            "deep-research-pipeline": {"research_brief", "decision_goal", "source_constraints"},
            "market-map": {"market_topic", "comparison_axes", "search_constraints"},
            "prospect-search": {"ideal_profile", "market_scope", "ranking_rules"},
            "research-brief-to-report": {"research_brief", "target_audience", "source_constraints"},
            "search-discovery": {"discovery_brief", "target_scope", "search_constraints"},
        }

        for playbook_slug, input_names in expected_inputs.items():
            with self.subTest(playbook_slug=playbook_slug):
                resolved = resolve_run_specs(
                    metadata,
                    selected_batches=["smoke"],
                    playbook_slug=playbook_slug,
                    variant="smoke",
                )

                self.assertEqual(1, len(resolved))
                run = resolved[0]
                self.assertEqual(playbook_slug, run["playbook_slug"])
                self.assertEqual(input_names, set(run["launch_inputs"].keys()))

    def test_resolve_run_specs_expands_workload_variant_and_upload_paths(self) -> None:
        metadata = load_metadata(str(METADATA_FILE))
        validate_metadata(metadata)

        resolved = resolve_run_specs(
            metadata,
            selected_batches=["smoke"],
            playbook_slug="bug-fix",
            variant="smoke",
        )

        self.assertEqual(1, len(resolved))
        run = resolved[0]
        self.assertEqual("bug-fix", run["playbook_slug"])
        self.assertEqual(
            "node-base",
            run["workspace_profile_record"]["default_execution_environment_alias"],
        )
        self.assertIn("launch_inputs", run)
        self.assertEqual(
            {"issue_summary", "reproduction_context", "acceptance_scope"},
            set(run["launch_inputs"].keys()),
        )
        self.assertGreaterEqual(len(run["uploads"]), 1)
        for upload_path in run["uploads"]:
            self.assertTrue(Path(upload_path).is_file(), upload_path)

    def test_resolve_run_specs_supports_research_native_search_variant_without_uploads(self) -> None:
        metadata = load_metadata(str(METADATA_FILE))
        validate_metadata(metadata)

        resolved = resolve_run_specs(
            metadata,
            selected_batches=["matrix"],
            playbook_slug="research-analysis",
            variant="native-search",
        )

        self.assertEqual(1, len(resolved))
        run = resolved[0]
        self.assertEqual("research-analysis", run["playbook_slug"])
        self.assertEqual("native-search", run["variant"])
        self.assertEqual([], run["uploads"])
        self.assertIn("research_question", run["launch_inputs"])
        self.assertIn("source_scope", run["launch_inputs"])

    def test_validate_metadata_rejects_missing_workload_file(self) -> None:
        metadata = load_metadata(str(METADATA_FILE))
        broken = copy.deepcopy(metadata)
        broken["runs"][0]["workload_file"] = "catalog/workloads/missing-workload.json"

        with self.assertRaisesRegex(RuntimeError, "missing workload file"):
            validate_metadata(broken)

    def test_validate_metadata_rejects_unknown_workload_variant(self) -> None:
        metadata = load_metadata(str(METADATA_FILE))
        broken = copy.deepcopy(metadata)
        broken["runs"][0]["workload_variant"] = "does-not-exist"

        with self.assertRaisesRegex(RuntimeError, "unknown workload variant"):
            validate_metadata(broken)

    def test_validate_metadata_rejects_blank_default_execution_environment_alias(self) -> None:
        metadata = load_metadata(str(METADATA_FILE))
        broken = copy.deepcopy(metadata)
        broken["workspace_profiles"]["git_remote_product_app"]["default_execution_environment_alias"] = ""

        with self.assertRaisesRegex(RuntimeError, "default_execution_environment_alias"):
            validate_metadata(broken)


if __name__ == "__main__":
    unittest.main()
