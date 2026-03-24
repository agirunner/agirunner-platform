#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from live_test_api import read_json
from scenario_config import load_scenario


EXPECTED_SCENARIOS = {
    "artifact-memory-publishing-approval",
    "artifact-only-human-review",
    "concurrency-assessment-race-matrix",
    "content-assessment-blocked",
    "content-block-subject-policy",
    "content-direct-successor-no-assessment",
    "content-escalate-policy",
    "content-multiple-assessments-then-human-review",
    "content-multiple-assessments-then-successor",
    "content-no-checkpoint-direct-flow",
    "content-retain-prior-assessment-on-rework",
    "content-route-to-role-rework-policy",
    "content-stale-assessment-arrives-after-rework",
    "content-terminate-branch-policy",
    "custom-checkpoint-names-multi-checkpoint",
    "custom-role-image-assessment",
    "default-image-assessment-flow",
    "host-directory-content-assessment",
    "host-directory-human-review-request-changes",
    "host-directory-parallel-assessors",
    "memory-only-no-checkpoint-assessment",
    "multi-active-subjects-same-workflow",
    "multi-orchestrator-concurrent-assessment-workflows",
    "one-orchestrator-many-workflows-assessment",
    "ongoing-intake-assessment-rework",
    "publishing-approval-before-assessment",
    "prose-only-sdlc-cycle-advisory",
    "requirements-human-review-approve",
    "requirements-human-review-blocked",
    "requirements-human-review-reject",
    "requirements-human-review-request-changes",
    "requirements-stale-human-review-arrives-after-rework",
    "same-assessor-role-across-checkpoints",
    "same-subject-role-different-assessors",
    "sdlc-all-assessors-request-changes",
    "sdlc-assessment-approve",
    "sdlc-assessment-reject-blocks-successor",
    "sdlc-assessment-request-changes-once",
    "sdlc-mixed-parallel-completion-order",
    "sdlc-multiple-rework-cycles",
    "sdlc-one-pending-one-approves",
    "sdlc-one-rejects-one-approves",
    "sdlc-optional-assessor-blocking",
    "sdlc-optional-assessor-fails-required-pass",
    "sdlc-optional-assessor-skipped",
    "sdlc-parallel-assessors-all-approve",
    "sdlc-parallel-assessors-mixed-outcomes",
    "sdlc-required-plus-optional-assessor-approve",
    "sdlc-required-plus-optional-assessor-pending",
    "sdlc-rework-invalidates-prior-assessments",
    "sdlc-sequential-assessors-all-approve",
}


REQUIRED_COVERAGE = {
    "delivery_paths": {
        "direct_successor",
        "assessment_then_successor",
        "human_review_then_successor",
        "assessment_then_human_review_then_successor",
        "human_review_then_assessment_then_successor",
    },
    "assessment_outcomes": {"approved", "request_changes", "rejected", "blocked"},
    "human_review_outcomes": {"approved", "request_changes", "rejected", "blocked"},
    "assessor_cardinality": {
        "zero",
        "one_required",
        "one_optional",
        "two_required",
        "mixed_required_optional",
        "parallel_same_revision",
        "sequential_same_revision",
    },
    "multi_assessor_outcomes": {
        "all_approve",
        "request_changes_plus_approve",
        "reject_plus_approve",
        "pending_plus_approve",
        "optional_fails_required_approve",
        "mixed_parallel_order",
    },
    "rework_actions": {"reopen_subject", "route_to_role", "escalate", "block_subject"},
    "subject_revisions": {
        "first_revision",
        "one_rework",
        "multiple_rework",
        "reassessment_new_revision",
        "invalidate_prior_assessments",
        "stale_late_assessment",
        "retain_prior_assessments",
        "stale_human_review",
    },
    "successor_gating": {
        "direct_after_handoff",
        "blocked_required_assessment",
        "blocked_after_blocked_assessment",
        "blocked_human_review",
        "blocked_human_review_blocked",
        "blocked_all_required_assessors",
        "allowed_optional_pending",
        "blocked_after_request_changes",
        "blocked_after_rejected",
    },
    "playbook_shapes": {
        "custom_role_names",
        "custom_checkpoint_names",
        "no_checkpoints",
        "one_checkpoint",
        "multiple_checkpoints",
        "assessor_reused_across_checkpoints",
        "subject_role_different_assessors",
    },
    "concurrency": {
        "same_subject_two_assessments",
        "simultaneous_completion",
        "out_of_order_completion",
        "duplicate_event_delivery",
        "duplicate_reopen_attempts",
        "multiple_active_subjects_same_workflow",
        "multiple_workflows_concurrent",
        "one_orchestrator_many_workflows",
        "multiple_orchestrators_concurrent",
    },
    "storage_execution": {
        "git_workspace",
        "host_directory_workspace",
        "artifact_heavy",
        "memory_heavy",
        "mixed_git_memory_artifacts",
        "default_image",
        "custom_role_image",
        "cold_specialists",
        "warm_orchestrators",
    },
    "advanced_policies": {
        "assessment_blocked_decision",
        "block_subject_outcome_action",
        "escalate_outcome_action",
        "assessment_retention_on_rework",
        "terminate_branch_outcome_action",
        "approval_before_assessment_ordering",
        "human_review_blocked_decision",
        "stale_human_review_after_rework",
    },
}


def read_fixture(path: str | Path) -> Any:
    return read_json(Path(path))


def collect_coverage_union(scenarios_dir: str | Path) -> dict[str, set[str]]:
    coverage_union: dict[str, set[str]] = {key: set() for key in REQUIRED_COVERAGE}
    for scenario_file in sorted(Path(scenarios_dir).glob("*.json")):
        scenario = load_scenario(scenario_file)
        for category, required_values in REQUIRED_COVERAGE.items():
            coverage_union[category].update(scenario.get("coverage", {}).get(category, []))
            unexpected = coverage_union[category] - required_values
            if unexpected:
                raise RuntimeError(
                    f"{scenario_file.name} declared unsupported coverage values for {category}: {sorted(unexpected)}"
                )
    return coverage_union
