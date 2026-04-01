#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Iterable, Mapping


SHARED_BOOTSTRAP_ENV_KEYS = (
    "COMPOSE_PROJECT_NAME",
    "DEFAULT_ADMIN_API_KEY",
    "JWT_SECRET",
    "LIVE_TEST_COMPOSE_PROJECT_NAME",
    "LIVE_TEST_COMPOSE_PROFILES",
    "LIVE_TEST_EXECUTION_ENVIRONMENT_SELECTION_SEED",
    "LIVE_TEST_MODEL_ENDPOINT_TYPE",
    "LIVE_TEST_MODEL_ID",
    "LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE",
    "LIVE_TEST_ORCHESTRATOR_MODEL_ID",
    "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT",
    "LIVE_TEST_ORCHESTRATOR_REPLICAS",
    "LIVE_TEST_PROVIDER_API_KEY",
    "LIVE_TEST_PROVIDER_AUTH_MODE",
    "LIVE_TEST_PROVIDER_BASE_URL",
    "LIVE_TEST_PROVIDER_NAME",
    "LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID",
    "LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON",
    "LIVE_TEST_PROVIDER_TYPE",
    "LIVE_TEST_REMOTE_MCP_FIXTURE_ACCESS_TOKEN",
    "LIVE_TEST_REMOTE_MCP_FIXTURE_CLIENT_ID",
    "LIVE_TEST_REMOTE_MCP_FIXTURE_CLIENT_SECRET",
    "LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET",
    "LIVE_TEST_REMOTE_MCP_FIXTURE_PORT",
    "LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE",
    "LIVE_TEST_SPECIALIST_MODEL_ID",
    "LIVE_TEST_SPECIALIST_REASONING_EFFORT",
    "LIVE_TEST_SYSTEM_REASONING_EFFORT",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "PLATFORM_API_PORT",
    "RUNTIME_IMAGE",
    "WEBHOOK_ENCRYPTION_KEY",
)

SHARED_BOOTSTRAP_DEFAULTS = {
    "LIVE_TEST_COMPOSE_PROJECT_NAME": "agirunner-platform",
    "LIVE_TEST_COMPOSE_PROFILES": "live-test",
    "LIVE_TEST_EXECUTION_ENVIRONMENT_SELECTION_SEED": "live-test-shared-bootstrap",
    "LIVE_TEST_MODEL_ENDPOINT_TYPE": "responses",
    "LIVE_TEST_MODEL_ID": "gpt-5.4",
    "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "gpt-5.4",
    "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT": "low",
    "LIVE_TEST_ORCHESTRATOR_REPLICAS": "2",
    "LIVE_TEST_PROVIDER_AUTH_MODE": "oauth",
    "LIVE_TEST_PROVIDER_BASE_URL": "https://chatgpt.com/backend-api",
    "LIVE_TEST_PROVIDER_NAME": "OpenAI (Subscription)",
    "LIVE_TEST_PROVIDER_TYPE": "openai",
    "LIVE_TEST_REMOTE_MCP_FIXTURE_PARAMETERIZED_SECRET": "live-test-parameterized-secret",
    "LIVE_TEST_REMOTE_MCP_FIXTURE_PORT": "18080",
    "LIVE_TEST_SPECIALIST_MODEL_ID": "gpt-5.4",
    "LIVE_TEST_SPECIALIST_REASONING_EFFORT": "medium",
    "LIVE_TEST_SYSTEM_REASONING_EFFORT": "medium",
    "PLATFORM_API_PORT": "8080",
    "RUNTIME_IMAGE": "agirunner-runtime:local",
}

PROVIDER_MODEL_DEFAULTS = {
    "anthropic": {
        "model_id": "claude-sonnet-4-6",
        "endpoint_type": "messages",
    },
    "google": {
        "model_id": "gemini-3.1-pro-preview",
        "endpoint_type": "generate-content",
    },
    "gemini": {
        "model_id": "gemini-3.1-pro-preview",
        "endpoint_type": "generate-content",
    },
    "openai": {
        "model_id": "gpt-5.4",
        "endpoint_type": "responses",
    },
    "openai-compatible": {
        "model_id": "gpt-5.4",
        "endpoint_type": "responses",
    },
}

PROVIDER_REASONING_DEFAULTS = {
    "anthropic": {
        "system_reasoning_effort": "low",
        "orchestrator_reasoning_effort": "low",
        "specialist_reasoning_effort": "low",
    },
    "google": {
        "system_reasoning_effort": "low",
        "orchestrator_reasoning_effort": "low",
        "specialist_reasoning_effort": "low",
    },
    "gemini": {
        "system_reasoning_effort": "low",
        "orchestrator_reasoning_effort": "low",
        "specialist_reasoning_effort": "low",
    },
    "openai": {
        "system_reasoning_effort": "medium",
        "orchestrator_reasoning_effort": "low",
        "specialist_reasoning_effort": "medium",
    },
    "openai-compatible": {
        "system_reasoning_effort": "medium",
        "orchestrator_reasoning_effort": "low",
        "specialist_reasoning_effort": "medium",
    },
}

IGNORED_PARTS = {
    ".git",
    ".pytest_cache",
    ".turbo",
    ".venv",
    "__pycache__",
    "coverage",
    "dist",
    "node_modules",
    "results",
}

IGNORED_SUFFIXES = {".pyc", ".pyo"}


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def resolve_provider_model_defaults(provider_type: str | None) -> dict[str, str]:
    normalized_provider = (provider_type or "").strip().lower()
    defaults = PROVIDER_MODEL_DEFAULTS.get(normalized_provider) or PROVIDER_MODEL_DEFAULTS["openai"]
    return dict(defaults)


def resolve_provider_reasoning_defaults(provider_type: str | None) -> dict[str, str]:
    normalized_provider = (provider_type or "").strip().lower()
    defaults = PROVIDER_REASONING_DEFAULTS.get(normalized_provider) or PROVIDER_REASONING_DEFAULTS["openai"]
    return dict(defaults)


def should_skip_path(path: Path) -> bool:
    return any(part in IGNORED_PARTS for part in path.parts) or path.suffix in IGNORED_SUFFIXES


def iter_tracked_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    if root.is_file():
        return [] if should_skip_path(root) else [root]
    return [
        path
        for path in sorted(root.rglob("*"))
        if path.is_file() and not should_skip_path(path)
    ]


def update_file_hash(digest: "hashlib._Hash", root: Path, path: Path) -> None:
    digest.update(path.relative_to(root).as_posix().encode("utf-8"))
    digest.update(b"\0")
    digest.update(hashlib.sha256(path.read_bytes()).digest())
    digest.update(b"\0")


def update_tree_hash(digest: "hashlib._Hash", label: str, root: Path) -> None:
    digest.update(label.encode("utf-8"))
    digest.update(b"\0")
    digest.update(root.as_posix().encode("utf-8"))
    digest.update(b"\0")
    if not root.exists():
        digest.update(b"missing\0")
        return
    for path in iter_tracked_files(root):
        update_file_hash(digest, root if root.is_dir() else root.parent, path)


def compute_shared_bootstrap_key(
    *,
    live_root: Path,
    repo_root: Path,
    runtime_repo_root: Path,
    environ: Mapping[str, str] | None = None,
) -> str:
    env = environ or os.environ
    provider_defaults = resolve_provider_model_defaults(env.get("LIVE_TEST_PROVIDER_TYPE"))
    provider_reasoning_defaults = resolve_provider_reasoning_defaults(env.get("LIVE_TEST_PROVIDER_TYPE"))
    model_id = env.get("LIVE_TEST_MODEL_ID") or provider_defaults["model_id"]
    model_endpoint_type = env.get("LIVE_TEST_MODEL_ENDPOINT_TYPE") or provider_defaults["endpoint_type"]
    payload = {
        "env": {
            key: (
                env.get("LIVE_TEST_PROVIDER_API_KEY")
                or env.get("LIVE_TEST_OPENAI_API_KEY", "")
                if key == "LIVE_TEST_PROVIDER_API_KEY"
                else model_id
                if key in {"LIVE_TEST_MODEL_ID", "LIVE_TEST_ORCHESTRATOR_MODEL_ID", "LIVE_TEST_SPECIALIST_MODEL_ID"}
                and not env.get(key)
                else provider_reasoning_defaults["system_reasoning_effort"]
                if key == "LIVE_TEST_SYSTEM_REASONING_EFFORT" and not env.get(key)
                else provider_reasoning_defaults["orchestrator_reasoning_effort"]
                if key == "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT" and not env.get(key)
                else provider_reasoning_defaults["specialist_reasoning_effort"]
                if key == "LIVE_TEST_SPECIALIST_REASONING_EFFORT" and not env.get(key)
                else model_endpoint_type
                if key in {"LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE", "LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE"}
                and not env.get(key)
                else env.get(key) or SHARED_BOOTSTRAP_DEFAULTS.get(key, "")
            )
            for key in SHARED_BOOTSTRAP_ENV_KEYS
        },
        "roots": {
            "live_root": str(live_root.resolve()),
            "repo_root": str(repo_root.resolve()),
            "runtime_repo_root": str(runtime_repo_root.resolve()),
        },
        "version": 1,
    }
    digest = hashlib.sha256()
    digest.update(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    digest.update(b"\0")

    hashed_roots = (
        ("platform-compose", repo_root / "docker-compose.yml"),
        ("platform-api", repo_root / "apps" / "platform-api"),
        ("platform-packages", repo_root / "packages"),
        ("container-manager", repo_root / "services" / "container-manager"),
        ("live-compose", live_root / "docker-compose.live-test.yml"),
        ("live-fixtures", live_root / "fixtures"),
        ("live-lib", live_root / "lib"),
        ("live-library", live_root / "library"),
        ("live-scripts", live_root / "scripts"),
        ("runtime-repo", runtime_repo_root),
    )
    for label, root in hashed_roots:
        update_tree_hash(digest, label, root)
    return digest.hexdigest()


def context_has_key(context_path: Path, expected_key: str) -> bool:
    if not context_path.is_file():
        return False
    try:
        payload = json.loads(context_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return str(payload.get("shared_bootstrap_key") or "").strip() == expected_key


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: bootstrap_key.py <compute|context-has-key> ...")

    command = sys.argv[1]
    if command == "compute":
        if len(sys.argv) != 5:
            raise SystemExit("usage: bootstrap_key.py compute <live-root> <repo-root> <runtime-repo-root>")
        print(
            compute_shared_bootstrap_key(
                live_root=Path(sys.argv[2]),
                repo_root=Path(sys.argv[3]),
                runtime_repo_root=Path(sys.argv[4]),
            )
        )
        return 0

    if command == "context-has-key":
        if len(sys.argv) != 4:
            raise SystemExit("usage: bootstrap_key.py context-has-key <context-file> <expected-key>")
        return 0 if context_has_key(Path(sys.argv[2]), sys.argv[3]) else 1

    raise SystemExit(f"unknown command: {command}")


if __name__ == "__main__":
    raise SystemExit(main())
