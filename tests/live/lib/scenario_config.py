#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from live_test_api import read_json


DEFAULT_TIMEOUT_SECONDS = 1800
DEFAULT_POLL_INTERVAL_SECONDS = 10


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
            "repo": bool(workspace.get("repo", True)),
            "memory": _read_mapping(workspace.get("memory"), "workspace.memory"),
            "spec": _read_mapping(workspace.get("spec"), "workspace.spec"),
        },
        "approvals": _read_list(payload.get("approvals"), "approvals"),
        "expect": _read_mapping(payload.get("expect"), "expect"),
        "timeout_seconds": int(payload.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)),
        "poll_interval_seconds": int(payload.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS)),
    }
