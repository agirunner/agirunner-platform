#!/usr/bin/env python3
from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
import sys
from typing import Any

from common import LIVE_LIB

if str(LIVE_LIB) not in sys.path:
    sys.path.insert(0, str(LIVE_LIB))

from run_workflow_scenario_chunk11 import build_workflow_create_payload


def extract_playbook_launch_inputs(playbook: dict[str, Any]) -> list[dict[str, Any]]:
    definition = playbook.get("definition")
    if not isinstance(definition, dict):
        return []
    parameters = definition.get("parameters")
    if not isinstance(parameters, list):
        return []

    launch_inputs: list[dict[str, Any]] = []
    for parameter in parameters:
        if not isinstance(parameter, dict):
            continue
        slug = str(parameter.get("slug") or "").strip()
        title = str(parameter.get("title") or "").strip()
        if not slug or not title:
            continue
        launch_inputs.append(
            {
                "slug": slug,
                "title": title,
                "required": bool(parameter.get("required", False)),
            }
        )
    return launch_inputs


def encode_operator_file_upload(path: str | Path) -> dict[str, str]:
    resolved = Path(path)
    payload = base64.b64encode(resolved.read_bytes()).decode("ascii")
    content_type, _ = mimetypes.guess_type(resolved.name)
    return {
        "file_name": resolved.name,
        "content_base64": payload,
        "content_type": content_type or "application/octet-stream",
    }


def build_workflow_name(playbook: dict[str, Any], run_spec: dict[str, Any]) -> str:
    playbook_name = str(playbook.get("name") or run_spec["playbook_slug"]).strip()
    first_input = next(iter(run_spec.get("launch_inputs", {}).values()), "")
    if isinstance(first_input, str) and first_input.strip():
        headline = first_input.strip().split(".")[0].strip()
        headline = headline[:72].rstrip()
        return f"{playbook_name}: {headline}"
    return f"{playbook_name}: {run_spec['variant']}"


def build_workflow_launch_payload(
    playbook: dict[str, Any],
    *,
    workspace_id: str,
    run_spec: dict[str, Any],
) -> dict[str, Any]:
    payload = build_workflow_create_payload(
        playbook_id=str(playbook["id"]),
        workspace_id=workspace_id,
        workflow_name=build_workflow_name(playbook, run_spec),
        scenario_name=str(run_spec["id"]),
        workflow_goal=next(iter(run_spec.get("launch_inputs", {}).values()), ""),
        playbook_launch_inputs=extract_playbook_launch_inputs(playbook),
        workflow_parameters=dict(run_spec.get("launch_inputs") or {}),
        workflow_metadata={
            "community_playbooks": {
                "run_id": run_spec["id"],
                "batch": run_spec.get("batch"),
                "playbook_slug": run_spec.get("playbook_slug"),
                "variant": run_spec.get("variant"),
            }
        },
    )
    uploads = [encode_operator_file_upload(path) for path in run_spec.get("uploads", [])]
    if uploads:
        payload["initial_input_packet"] = {
            "summary": f"Community workload {run_spec['id']}",
            "files": uploads,
        }
    return payload
