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
        if not playbook_slug:
            raise RuntimeError(f"run {run_id!r} is missing playbook_slug")
        if not variant:
            raise RuntimeError(f"run {run_id!r} is missing variant")
        if workspace_profile not in workspace_profiles:
            raise RuntimeError(f"run {run_id!r} references unknown workspace profile {workspace_profile!r}")

        for upload_path in run.get("uploads", []):
            candidate = relative_to_suite(upload_path)
            if not candidate.is_file():
                raise RuntimeError(f"run {run_id!r} references missing upload fixture {upload_path!r}")

    for profile_name, profile in workspace_profiles.items():
        if not isinstance(profile, dict):
            raise RuntimeError(f"workspace profile {profile_name!r} must be an object")
        storage_type = str(profile.get("storage_type") or "").strip()
        if storage_type not in {"git_remote", "host_directory", "workspace_artifacts"}:
            raise RuntimeError(f"workspace profile {profile_name!r} uses unsupported storage type {storage_type!r}")
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
        resolved.append(
            {
                **run,
                "workspace_profile_record": dict(workspace_profiles[str(run["workspace_profile"])]),
                "uploads": [str(relative_to_suite(item)) for item in run.get("uploads", [])],
            }
        )
    return resolved
