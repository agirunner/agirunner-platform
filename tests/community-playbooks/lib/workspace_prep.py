#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from common import read_env, repo_root, run_command
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


def build_git_run_branch(run_spec: dict[str, Any]) -> str:
    return f"community-playbooks/{run_spec['id']}"


def _copy_seed_tree(seed_root: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for child in seed_root.iterdir():
        target = destination / child.name
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)


def prepare_git_remote_workspace(
    run_spec: dict[str, Any],
    *,
    output_root: str | Path,
) -> dict[str, str]:
    profile = dict(run_spec["workspace_profile_record"])
    seed_path = Path(profile["seed_path"])
    if not seed_path.is_absolute():
        seed_path = repo_root() / "tests" / "community-playbooks" / seed_path
    fixtures_root = Path(
        os.environ.get("FIXTURES_REPO_PATH", repo_root().parent / "agirunner-test-fixtures")
    )
    remote_name = os.environ.get("LIVE_TEST_FIXTURES_REMOTE_NAME", "origin")
    default_branch = read_env("LIVE_TEST_DEFAULT_BRANCH", "main")
    git_user_name = read_env("LIVE_TEST_GIT_USER_NAME", required=True)
    git_user_email = read_env("LIVE_TEST_GIT_USER_EMAIL", required=True)
    run_branch = build_git_run_branch(run_spec)
    working_root = Path(output_root) / "git-remote" / run_spec["id"]
    if working_root.exists():
        shutil.rmtree(working_root)
    run_command(["git", "-C", str(fixtures_root), "fetch", "--prune", remote_name], capture_output=True)
    run_command(["git", "clone", str(fixtures_root), str(working_root)], capture_output=True)
    run_command(
        ["git", "-C", str(working_root), "checkout", "-B", run_branch, f"{remote_name}/{default_branch}"],
        capture_output=True,
    )
    run_command(["git", "-C", str(working_root), "config", "user.name", git_user_name], capture_output=True)
    run_command(["git", "-C", str(working_root), "config", "user.email", git_user_email], capture_output=True)
    for child in working_root.iterdir():
        if child.name == ".git":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    _copy_seed_tree(seed_path, working_root)
    run_command(["git", "-C", str(working_root), "add", "-A"], capture_output=True)
    status_output = run_command(["git", "-C", str(working_root), "status", "--porcelain"], capture_output=True).stdout
    commit_command = ["git", "-C", str(working_root), "commit"]
    if status_output.strip() == "":
        commit_command.append("--allow-empty")
    commit_command.extend(["-m", f"chore: prepare {run_spec['id']}"])
    run_command(commit_command, capture_output=True)
    repository_url = read_env("LIVE_TEST_REPOSITORY_URL")
    if repository_url == "":
        repository_url = run_command(
            ["git", "-C", str(fixtures_root), "remote", "get-url", "--push", remote_name],
            capture_output=True,
        ).stdout.strip()
    run_command(
        ["git", "-C", str(working_root), "remote", "set-url", "--push", "origin", repository_url],
        capture_output=True,
    )
    run_command(["git", "-C", str(working_root), "push", "--force", "origin", f"HEAD:{run_branch}"], capture_output=True)
    return {
        "repository_url": repository_url,
        "default_branch": run_branch,
        "working_root": str(working_root),
        "seed_path": str(seed_path),
    }


def prepare_workspace_materials(
    run_spec: dict[str, Any],
    *,
    output_root: str | Path,
) -> dict[str, str]:
    profile = dict(run_spec["workspace_profile_record"])
    storage_type = str(profile["storage_type"])
    suite_root = repo_root() / "tests" / "community-playbooks"
    if storage_type == "host_directory":
        seed_root = suite_root / str(profile["seed_path"])
        prepared = copy_host_workspace_seed(seed_root, Path(output_root) / "host-directory", run_id=str(run_spec["id"]))
        return {
            "host_path": str(prepared),
            "seed_path": str(seed_root),
        }
    if storage_type == "git_remote":
        return prepare_git_remote_workspace(run_spec, output_root=output_root)
    return {}


def build_workspace_create_input(
    run_spec: dict[str, Any],
    *,
    prepared_host_path: str | None = None,
    repository_url: str | None = None,
    default_branch: str | None = None,
) -> dict[str, Any]:
    profile = dict(run_spec["workspace_profile_record"])
    storage_type = str(profile["storage_type"])
    resolved_repository_url = repository_url or read_env("LIVE_TEST_REPOSITORY_URL")
    resolved_default_branch = default_branch or read_env("LIVE_TEST_DEFAULT_BRANCH", "main")
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
        repository_url=resolved_repository_url,
        default_branch=resolved_default_branch,
        git_user_name=git_user_name,
        git_user_email=git_user_email,
        git_token=git_token,
        host_workspace_path=host_path,
    )
