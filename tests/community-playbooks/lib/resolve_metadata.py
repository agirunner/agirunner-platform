#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

from common import read_json_file, relative_to_suite


SUPPORTED_BATCHES = {"smoke", "matrix", "controls"}
METADATA_FILE = relative_to_suite("catalog/playbook-runs.json")


def load_metadata(path: str | None = None) -> dict[str, Any]:
    metadata = read_json_file(path or METADATA_FILE)
    if not isinstance(metadata, dict):
        raise RuntimeError("community playbook metadata must be a JSON object")
    workspace_profiles = metadata.get("workspace_profiles")
    runs = metadata.get("runs")
    if not isinstance(workspace_profiles, dict):
        raise RuntimeError("metadata.workspace_profiles must be an object")
    if not isinstance(runs, list):
        raise RuntimeError("metadata.runs must be an array")
    return metadata


def load_workload(path: str) -> dict[str, Any]:
    workload = read_json_file(relative_to_suite(path))
    if not isinstance(workload, dict):
        raise RuntimeError(f"community workload {path!r} must be a JSON object")
    variants = workload.get("variants")
    if not isinstance(variants, dict):
        raise RuntimeError(f"community workload {path!r} must define variants")
    return workload


def resolve_workload_variant(run: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    workload_file = str(run.get("workload_file") or "").strip()
    workload_variant = str(run.get("workload_variant") or "").strip()
    workload = load_workload(workload_file)
    variants = workload["variants"]
    variant = variants.get(workload_variant)
    if not isinstance(variant, dict):
        raise RuntimeError(f"run {run.get('id')!r} references unknown workload variant {workload_variant!r}")
    return workload, variant


def validate_metadata(metadata: dict[str, Any]) -> None:
    workspace_profiles = metadata["workspace_profiles"]
    seen_ids: set[str] = set()
    for index, run in enumerate(metadata["runs"]):
        if not isinstance(run, dict):
            raise RuntimeError(f"metadata.runs[{index}] must be an object")
        run_id = str(run.get("id") or "").strip()
        if not run_id:
            raise RuntimeError(f"metadata.runs[{index}] is missing id")
        if run_id in seen_ids:
            raise RuntimeError(f"duplicate run id {run_id!r}")
        seen_ids.add(run_id)

        batch = str(run.get("batch") or "").strip()
        if batch not in SUPPORTED_BATCHES:
            raise RuntimeError(f"run {run_id!r} uses unsupported batch {batch!r}")

        playbook_slug = str(run.get("playbook_slug") or "").strip()
        variant = str(run.get("variant") or "").strip()
        workspace_profile = str(run.get("workspace_profile") or "").strip()
        workload_file = str(run.get("workload_file") or "").strip()
        workload_variant = str(run.get("workload_variant") or "").strip()
        if not playbook_slug:
            raise RuntimeError(f"run {run_id!r} is missing playbook_slug")
        if not variant:
            raise RuntimeError(f"run {run_id!r} is missing variant")
        if workspace_profile not in workspace_profiles:
            raise RuntimeError(f"run {run_id!r} references unknown workspace profile {workspace_profile!r}")
        if not workload_file:
            raise RuntimeError(f"run {run_id!r} is missing workload_file")
        if not workload_variant:
            raise RuntimeError(f"run {run_id!r} is missing workload_variant")
        if not relative_to_suite(workload_file).is_file():
            raise RuntimeError(f"run {run_id!r} references missing workload file {workload_file!r}")

        workload, resolved_variant = resolve_workload_variant(run)
        workload_playbook_slug = str(workload.get("playbook_slug") or "").strip()
        if workload_playbook_slug != playbook_slug:
            raise RuntimeError(
                f"run {run_id!r} playbook_slug {playbook_slug!r} does not match workload playbook {workload_playbook_slug!r}"
            )

        launch_inputs = resolved_variant.get("launch_inputs")
        if not isinstance(launch_inputs, dict) or not launch_inputs:
            raise RuntimeError(f"run {run_id!r} workload variant {workload_variant!r} is missing launch_inputs")

        for input_name, value in launch_inputs.items():
            if not isinstance(input_name, str) or input_name.strip() == "":
                raise RuntimeError(f"run {run_id!r} workload variant {workload_variant!r} has an invalid input name")
            if not isinstance(value, str) or value.strip() == "":
                raise RuntimeError(
                    f"run {run_id!r} workload variant {workload_variant!r} input {input_name!r} must be a non-empty string"
                )

        uploads = resolved_variant.get("uploads", [])
        if uploads is None:
            uploads = []
        if not isinstance(uploads, list):
            raise RuntimeError(f"run {run_id!r} workload variant {workload_variant!r} uploads must be an array")
        for upload_path in uploads:
            candidate = relative_to_suite(upload_path)
            if not candidate.is_file():
                raise RuntimeError(f"run {run_id!r} references missing upload fixture {upload_path!r}")

    for profile_name, profile in workspace_profiles.items():
        if not isinstance(profile, dict):
            raise RuntimeError(f"workspace profile {profile_name!r} must be an object")
        storage_type = str(profile.get("storage_type") or "").strip()
        if storage_type not in {"git_remote", "host_directory", "workspace_artifacts"}:
            raise RuntimeError(f"workspace profile {profile_name!r} uses unsupported storage type {storage_type!r}")
        default_execution_environment_alias = profile.get("default_execution_environment_alias")
        if default_execution_environment_alias is not None and (
            not isinstance(default_execution_environment_alias, str)
            or not default_execution_environment_alias.strip()
        ):
            raise RuntimeError(
                f"workspace profile {profile_name!r} must use a non-empty default_execution_environment_alias when provided"
            )
        seed_path = profile.get("seed_path")
        if storage_type in {"git_remote", "host_directory"}:
            if not isinstance(seed_path, str) or not seed_path.strip():
                raise RuntimeError(f"workspace profile {profile_name!r} is missing seed_path")
            if not relative_to_suite(seed_path).is_dir():
                raise RuntimeError(f"workspace profile {profile_name!r} references missing seed_path {seed_path!r}")


def resolve_run_specs(
    metadata: dict[str, Any],
    *,
    selected_batches: list[str] | None = None,
    playbook_slug: str | None = None,
    variant: str | None = None,
    failed_only_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    workspace_profiles = metadata["workspace_profiles"]
    batch_filter = set(selected_batches or SUPPORTED_BATCHES)
    resolved: list[dict[str, Any]] = []
    for run in metadata["runs"]:
        batch = str(run["batch"])
        if batch not in batch_filter:
            continue
        if playbook_slug and str(run["playbook_slug"]) != playbook_slug:
            continue
        if variant and str(run["variant"]) != variant:
            continue
        if failed_only_ids is not None and str(run["id"]) not in failed_only_ids:
            continue
        _, workload_variant = resolve_workload_variant(run)
        resolved.append(
            {
                **run,
                "workspace_profile_record": dict(workspace_profiles[str(run["workspace_profile"])]),
                "launch_inputs": dict(workload_variant.get("launch_inputs") or {}),
                "steering_script": list(workload_variant.get("steering_script") or []),
                "operator_actions": list(workload_variant.get("operator_actions") or []),
                "expected_outcome": dict(workload_variant.get("expected_outcome") or {}),
                "mcp_allowed": bool(workload_variant.get("mcp_allowed", False)),
                "uploads": [
                    str(relative_to_suite(item))
                    for item in list(workload_variant.get("uploads") or [])
                ],
            }
        )
    return resolved
