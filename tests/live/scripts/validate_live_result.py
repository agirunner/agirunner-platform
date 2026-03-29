#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


REQUIRED_SETTLED_EVIDENCE_KEYS = (
    "db_state",
    "execution_environment_usage",
    "capability_proof",
    "remote_mcp_fixture",
    "log_anomalies",
    "http_status_summary",
    "live_containers",
    "container_observations",
    "runtime_cleanup",
    "docker_log_rotation",
    "scenario_outcome_metrics",
    "workspace_scope_trace",
)


@dataclass
class ValidationResult:
    is_valid: bool
    is_passing: bool
    failures: list[str]
    harness_failure: bool


def validate_result_file(path: Path) -> ValidationResult:
    if not path.is_file():
        return ValidationResult(
            is_valid=False,
            is_passing=False,
            failures=[f"workflow-run.json not found: {path}"],
            harness_failure=False,
        )

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        return ValidationResult(
            is_valid=False,
            is_passing=False,
            failures=[f"workflow-run.json is not valid JSON: {error}"],
            harness_failure=False,
        )

    if not isinstance(payload, dict):
        return ValidationResult(
            is_valid=False,
            is_passing=False,
            failures=["workflow-run.json must contain a top-level JSON object"],
            harness_failure=False,
        )

    if payload.get("harness_failure") is True:
        failures = validate_harness_failure_payload(payload)
        return ValidationResult(
            is_valid=len(failures) == 0,
            is_passing=False,
            failures=failures,
            harness_failure=True,
        )

    failures = validate_settled_result_payload(payload)
    verification = payload.get("verification")
    is_passing = (
        len(failures) == 0
        and isinstance(verification, dict)
        and verification.get("passed") is True
        and payload.get("verification_passed") is True
    )
    return ValidationResult(
        is_valid=len(failures) == 0,
        is_passing=is_passing,
        failures=failures,
        harness_failure=False,
    )


def validate_harness_failure_payload(payload: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    require_non_empty_string(payload, "scenario_name", failures)
    verification = require_mapping(payload, "verification", failures)
    harness = require_mapping(payload, "harness", failures)

    if verification is not None:
        if verification.get("passed") is not False:
            failures.append("harness failure verification.passed must be false")
        failure_list = verification.get("failures")
        if not isinstance(failure_list, list) or not failure_list:
            failures.append("harness failure verification.failures must be a non-empty list")

    if harness is not None:
        require_non_empty_string(harness, "phase", failures, prefix="harness.")
        if not isinstance(harness.get("exit_code"), int):
            failures.append("harness.exit_code must be an integer")

    return failures


def validate_settled_result_payload(payload: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    require_non_empty_string(payload, "scenario_name", failures)
    require_non_empty_string(payload, "workflow_state", failures)
    require_non_empty_string(payload, "state", failures)

    if not isinstance(payload.get("runner_exit_code"), int):
        failures.append("runner_exit_code must be an integer")
    if not isinstance(payload.get("verification_passed"), bool):
        failures.append("verification_passed must be a boolean")

    verification = require_mapping(payload, "verification", failures)
    if verification is not None:
        if not isinstance(verification.get("passed"), bool):
            failures.append("verification.passed must be a boolean")
        if not isinstance(verification.get("failures"), list):
            failures.append("verification.failures must be a list")

    if not isinstance(payload.get("outcome_metrics"), dict):
        failures.append("outcome_metrics must be an object")

    evidence = require_mapping(payload, "evidence", failures)
    if evidence is None:
        return failures

    artifacts = evidence.get("artifacts")
    if not isinstance(artifacts, dict):
        failures.append("evidence.artifacts must be an object")
        artifacts = {}

    for key in REQUIRED_SETTLED_EVIDENCE_KEYS:
        if not isinstance(evidence.get(key), dict):
            failures.append(f"missing required evidence payload for {key}")
        artifact_path = artifacts.get(key)
        if not isinstance(artifact_path, str) or artifact_path.strip() == "":
            failures.append(f"missing evidence artifact path for {key}")
            continue
        candidate = Path(artifact_path)
        if not candidate.is_file():
            failures.append(f"missing evidence artifact file for {key}: {candidate}")
            continue
        if candidate.stat().st_size <= 0:
            failures.append(f"evidence artifact file for {key} is empty: {candidate}")
            continue
        try:
            artifact_payload = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception as error:
            failures.append(f"evidence artifact for {key} is not valid JSON: {error}")
            continue
        if not isinstance(artifact_payload, dict):
            failures.append(f"evidence artifact for {key} must contain a JSON object")
            continue
        if key == "workspace_scope_trace":
            failures.extend(validate_workspace_scope_trace(artifact_payload))

    return failures


def validate_workspace_scope_trace(payload: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    if payload.get("ok") is not True:
        failures.append("workspace_scope_trace.ok must be true")
    require_non_empty_string(payload, "selected_work_item_id", failures, prefix="workspace_scope_trace.")

    root_failures = payload.get("failures")
    if root_failures is None:
        failures.append("workspace_scope_trace.failures must be a list")
    elif not isinstance(root_failures, list):
        failures.append("workspace_scope_trace.failures must be a list")
    else:
        failures.extend(read_failure_messages(root_failures, prefix="workspace_scope_trace"))

    for scope_key, expected_kind in (
        ("workflow_scope", "workflow"),
        ("selected_work_item_scope", "selected_work_item"),
    ):
        scope_payload = require_mapping(payload, scope_key, failures, prefix="workspace_scope_trace.")
        if scope_payload is None:
            continue
        failures.extend(validate_scope_entry(scope_key, expected_kind, scope_payload))

    return failures


def validate_scope_entry(scope_key: str, expected_kind: str, payload: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    actual_kind = payload.get("scope_kind")
    if actual_kind != expected_kind:
        failures.append(f"{scope_key}.scope_kind must be {expected_kind}")

    selection = require_mapping(payload, "selection", failures, prefix=f"{scope_key}.")
    if selection is not None:
        if expected_kind == "workflow":
            if selection.get("work_item_id") is not None:
                failures.append(f"{scope_key}.selection.work_item_id must be null")
            if selection.get("task_id") is not None:
                failures.append(f"{scope_key}.selection.task_id must be null")
        else:
            require_non_empty_string(selection, "work_item_id", failures, prefix=f"{scope_key}.selection.")
            if expected_kind == "selected_task":
                require_non_empty_string(selection, "task_id", failures, prefix=f"{scope_key}.selection.")

    workspace_api = require_mapping(payload, "workspace_api", failures, prefix=f"{scope_key}.")
    if workspace_api is not None:
        require_mapping(workspace_api, "selected_scope", failures, prefix=f"{scope_key}.workspace_api.")
        live_console = require_mapping(workspace_api, "live_console", failures, prefix=f"{scope_key}.workspace_api.")
        if live_console is not None:
            require_list(live_console, "brief_ids", failures, prefix=f"{scope_key}.workspace_api.live_console.")
            require_list(
                live_console,
                "execution_turn_ids",
                failures,
                prefix=f"{scope_key}.workspace_api.live_console.",
            )
            require_list(
                live_console,
                "execution_turn_items",
                failures,
                prefix=f"{scope_key}.workspace_api.live_console.",
            )
            require_mapping(
                live_console,
                "item_kind_counts",
                failures,
                prefix=f"{scope_key}.workspace_api.live_console.",
            )
        deliverables = require_mapping(workspace_api, "deliverables", failures, prefix=f"{scope_key}.workspace_api.")
        if deliverables is not None:
            require_list(
                deliverables,
                "all_descriptor_ids",
                failures,
                prefix=f"{scope_key}.workspace_api.deliverables.",
            )
            require_mapping(
                deliverables,
                "descriptor_kind_counts",
                failures,
                prefix=f"{scope_key}.workspace_api.deliverables.",
            )

    db_payload = require_mapping(payload, "db", failures, prefix=f"{scope_key}.")
    if db_payload is not None:
        require_list(db_payload, "brief_ids", failures, prefix=f"{scope_key}.db.")
        require_list(db_payload, "all_descriptor_ids", failures, prefix=f"{scope_key}.db.")

    enhanced_live_console = require_mapping(payload, "enhanced_live_console", failures, prefix=f"{scope_key}.")
    if enhanced_live_console is not None:
        if not isinstance(enhanced_live_console.get("applicable"), bool):
            failures.append(f"{scope_key}.enhanced_live_console.applicable must be a boolean")
        if enhanced_live_console.get("applicable") is True:
            require_non_empty_string(
                enhanced_live_console,
                "effective_mode",
                failures,
                prefix=f"{scope_key}.enhanced_live_console.",
            )
        require_list(
            enhanced_live_console,
            "expected_rows",
            failures,
            prefix=f"{scope_key}.enhanced_live_console.",
        )
        require_list(
            enhanced_live_console,
            "actual_rows",
            failures,
            prefix=f"{scope_key}.enhanced_live_console.",
        )
        if enhanced_live_console.get("passed") is not True:
            failures.append(f"{scope_key}.enhanced_live_console.passed must be true")
        failure_list = enhanced_live_console.get("failures")
        if not isinstance(failure_list, list):
            failures.append(f"{scope_key}.enhanced_live_console.failures must be a list")
        else:
            failures.extend(read_failure_messages(failure_list, prefix=f"{scope_key}.enhanced_live_console"))

    reconciliation = require_mapping(payload, "reconciliation", failures, prefix=f"{scope_key}.")
    if reconciliation is not None:
        if reconciliation.get("passed") is not True:
            failures.append(f"{scope_key}.reconciliation.passed must be true")
        failure_list = reconciliation.get("failures")
        if not isinstance(failure_list, list):
            failures.append(f"{scope_key}.reconciliation.failures must be a list")
        else:
            failures.extend(read_failure_messages(failure_list, prefix=scope_key))
    return failures


def require_mapping(
    payload: dict[str, Any],
    key: str,
    failures: list[str],
    *,
    prefix: str = "",
) -> dict[str, Any] | None:
    value = payload.get(key)
    if not isinstance(value, dict):
        failures.append(f"{prefix}{key} must be an object")
        return None
    return value


def require_non_empty_string(
    payload: dict[str, Any],
    key: str,
    failures: list[str],
    *,
    prefix: str = "",
) -> None:
    value = payload.get(key)
    if not isinstance(value, str) or value.strip() == "":
        failures.append(f"{prefix}{key} must be a non-empty string")


def require_list(
    payload: dict[str, Any],
    key: str,
    failures: list[str],
    *,
    prefix: str = "",
) -> list[Any] | None:
    value = payload.get(key)
    if not isinstance(value, list):
        failures.append(f"{prefix}{key} must be a list")
        return None
    return value


def read_failure_messages(values: list[Any], *, prefix: str) -> list[str]:
    failures: list[str] = []
    for value in values:
        if isinstance(value, str) and value.strip() != "":
            failures.append(value.strip())
        else:
            failures.append(f"{prefix}.failures must contain only non-empty strings")
    return failures


def scenario_names_from_inputs(scenario_root: Path, tracker_file: str) -> list[str]:
    scenario_files = {path.stem for path in scenario_root.glob("*.json")}
    if tracker_file.strip() == "":
        return sorted(scenario_files)

    tracker = json.loads(Path(tracker_file).read_text(encoding="utf-8"))
    ordered = tracker.get("supported", {}).get("scenarios", [])
    if not isinstance(ordered, list):
        raise SystemExit("[tests/live] supported.scenarios must be a list in live test tracker")
    missing = [name for name in ordered if name not in scenario_files]
    if missing:
        raise SystemExit(
            "[tests/live] tracker scenarios missing JSON definitions: " + ", ".join(missing)
        )
    return [str(name) for name in ordered]


def emit_validation(path_text: str) -> int:
    print(json.dumps(asdict(validate_result_file(Path(path_text))), separators=(",", ":")))
    return 0


def emit_matrix_status(scenario_root_text: str, artifacts_root_text: str, tracker_file: str) -> int:
    scenario_names = scenario_names_from_inputs(Path(scenario_root_text), tracker_file)
    artifacts_root = Path(artifacts_root_text)
    total = len(scenario_names)
    passed = 0
    for scenario_name in scenario_names:
        if validate_result_file(artifacts_root / scenario_name / "workflow-run.json").is_passing:
            passed += 1
    print(f"{passed}\t{total - passed}\t{total}")
    return 0


def emit_failing_scenarios(scenario_root_text: str, artifacts_root_text: str, tracker_file: str) -> int:
    scenario_names = scenario_names_from_inputs(Path(scenario_root_text), tracker_file)
    artifacts_root = Path(artifacts_root_text)
    for scenario_name in scenario_names:
        if not validate_result_file(artifacts_root / scenario_name / "workflow-run.json").is_passing:
            print(scenario_name)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        raise SystemExit(
            "usage: validate_live_result.py <validate|matrix-status|failing-scenarios> <args...>"
        )

    command = argv[1]
    if command == "validate":
        return emit_validation(argv[2])
    if command == "matrix-status":
        tracker_file = argv[4] if len(argv) > 4 else ""
        return emit_matrix_status(argv[2], argv[3], tracker_file)
    if command == "failing-scenarios":
        tracker_file = argv[4] if len(argv) > 4 else ""
        return emit_failing_scenarios(argv[2], argv[3], tracker_file)

    raise SystemExit(f"unknown command: {command}")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
