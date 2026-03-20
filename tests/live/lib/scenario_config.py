#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from live_test_api import read_json


DEFAULT_TIMEOUT_SECONDS = 1800
DEFAULT_POLL_INTERVAL_SECONDS = 10
WORKSPACE_STORAGE_TYPES = {"git_remote", "host_directory", "workspace_artifacts"}


def _read_mapping(value: Any, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RuntimeError(f"{field_name} must be an object")
    return dict(value)


def _read_list(value: Any, field_name: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RuntimeError(f"{field_name} must be a list")
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise RuntimeError(f"{field_name}[{index}] must be an object")
        normalized.append(dict(item))
    return normalized


def _read_workspace_storage(value: Any, *, repo_default: bool) -> dict[str, Any]:
    storage = _read_mapping(value, "workspace.storage")
    storage_type = str(storage.get("type") or "").strip()
    if storage_type == "":
        storage_type = "git_remote" if repo_default else "workspace_artifacts"
    if storage_type not in WORKSPACE_STORAGE_TYPES:
        raise RuntimeError(f"workspace.storage.type must be one of: {sorted(WORKSPACE_STORAGE_TYPES)}")

    normalized: dict[str, Any] = {
        "type": storage_type,
        "read_only": bool(storage.get("read_only", False)),
    }
    host_path = storage.get("host_path")
    if isinstance(host_path, str) and host_path.strip() != "":
        normalized["host_path"] = host_path.strip()
    return normalized


def load_scenario(path: str | Path) -> dict[str, Any]:
    scenario_path = Path(path)
    payload = read_json(scenario_path)
    if not isinstance(payload, dict):
        raise RuntimeError("scenario file must contain an object")

    scenario_name = str(payload.get("name") or scenario_path.stem).strip()
    if scenario_name == "":
        raise RuntimeError("scenario name is required")

    workflow = _read_mapping(payload.get("workflow"), "workflow")
    workflow_name = str(workflow.get("name") or scenario_name).strip()
    workflow_goal = str(workflow.get("goal") or "").strip()
    if workflow_goal == "":
        raise RuntimeError("workflow.goal is required")
    workflow_parameters = _read_mapping(workflow.get("parameters"), "workflow.parameters")
    workflow_metadata = _read_mapping(workflow.get("metadata"), "workflow.metadata")

    workspace = _read_mapping(payload.get("workspace"), "workspace")
    repo_default = bool(workspace.get("repo", True))
    storage = _read_workspace_storage(workspace.get("storage"), repo_default=repo_default)

    return {
        "name": scenario_name,
        "profile": str(payload.get("profile") or scenario_name).strip(),
        "workflow": {
            "name": workflow_name,
            "goal": workflow_goal,
            "parameters": workflow_parameters,
            "metadata": workflow_metadata,
        },
        "workspace": {
            "repo": storage["type"] == "git_remote",
            "storage": storage,
            "memory": _read_mapping(workspace.get("memory"), "workspace.memory"),
            "spec": _read_mapping(workspace.get("spec"), "workspace.spec"),
        },
        "approvals": _read_list(payload.get("approvals"), "approvals"),
        "actions": _read_list(payload.get("actions"), "actions"),
        "expect": _read_mapping(payload.get("expect"), "expect"),
        "timeout_seconds": int(payload.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)),
        "poll_interval_seconds": int(payload.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS)),
    }
