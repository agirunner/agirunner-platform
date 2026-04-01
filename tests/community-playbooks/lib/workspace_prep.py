#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from common import read_env
from seed_live_test_environment_chunk03a import build_workspace_create_payload


def build_workspace_slug(run_spec: dict[str, Any]) -> str:
    return f"{run_spec['id']}-workspace"


def build_workspace_name(run_spec: dict[str, Any]) -> str:
    return f"{run_spec['playbook_slug']} {run_spec['variant']} workspace"


def copy_host_workspace_seed(seed_root: str | Path, target_root: str | Path, *, run_id: str) -> Path:
    source = Path(seed_root)
    destination = Path(target_root) / run_id
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)
    return destination


def build_workspace_create_input(
    run_spec: dict[str, Any],
    *,
    prepared_host_path: str | None = None,
) -> dict[str, Any]:
    profile = dict(run_spec["workspace_profile_record"])
    storage_type = str(profile["storage_type"])
    repository_url = read_env("LIVE_TEST_REPOSITORY_URL")
    default_branch = read_env("LIVE_TEST_DEFAULT_BRANCH", "main")
    git_user_name = read_env("LIVE_TEST_GIT_USER_NAME")
    git_user_email = read_env("LIVE_TEST_GIT_USER_EMAIL")
    git_token = read_env("LIVE_TEST_GIT_TOKEN") or read_env("LIVE_TEST_GITHUB_TOKEN")
    host_path = prepared_host_path
    if storage_type == "host_directory" and (host_path is None or host_path.strip() == ""):
        raise RuntimeError("prepared host workspace path is required for host_directory profiles")

    return build_workspace_create_payload(
        workspace_name=build_workspace_name(run_spec),
        workspace_slug=build_workspace_slug(run_spec),
        workspace_description=f"Community playbooks suite workspace for {run_spec['id']}",
        workspace_config={
            "repo": storage_type == "git_remote",
            "storage": {
                "type": storage_type,
                "host_path": host_path,
                "read_only": False,
            },
        },
        repository_url=repository_url,
        default_branch=default_branch,
        git_user_name=git_user_name,
        git_user_email=git_user_email,
        git_token=git_token,
        host_workspace_path=host_path,
    )
