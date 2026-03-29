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
        try:
            artifact_payload = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception as error:
            failures.append(f"evidence artifact for {key} is not valid JSON: {error}")
            continue
        if not isinstance(artifact_payload, dict):
            failures.append(f"evidence artifact for {key} must contain a JSON object")

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
