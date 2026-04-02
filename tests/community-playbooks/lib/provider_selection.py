#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping

from common import live_root


PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "anthropic": {
        "snapshot_heading": "Anthropic API",
        "LIVE_TEST_PROVIDER_AUTH_MODE": "api_key",
        "LIVE_TEST_PROVIDER_TYPE": "anthropic",
        "LIVE_TEST_PROVIDER_NAME": "Anthropic",
        "LIVE_TEST_PROVIDER_BASE_URL": "https://api.anthropic.com",
        "LIVE_TEST_SYSTEM_REASONING_EFFORT": "low",
        "LIVE_TEST_MODEL_ID": "claude-sonnet-4-6",
        "LIVE_TEST_MODEL_ENDPOINT_TYPE": "messages",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "claude-sonnet-4-6",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE": "messages",
        "LIVE_TEST_SPECIALIST_MODEL_ID": "claude-sonnet-4-6",
        "LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE": "messages",
        "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT": "low",
        "LIVE_TEST_SPECIALIST_REASONING_EFFORT": "low",
    },
    "gemini": {
        "snapshot_heading": "Gemini API",
        "LIVE_TEST_PROVIDER_AUTH_MODE": "api_key",
        "LIVE_TEST_PROVIDER_TYPE": "google",
        "LIVE_TEST_PROVIDER_NAME": "Gemini",
        "LIVE_TEST_PROVIDER_BASE_URL": "https://generativelanguage.googleapis.com",
        "LIVE_TEST_SYSTEM_REASONING_EFFORT": "low",
        "LIVE_TEST_MODEL_ID": "gemini-3.1-pro-preview",
        "LIVE_TEST_MODEL_ENDPOINT_TYPE": "generate-content",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "gemini-3.1-pro-preview",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE": "generate-content",
        "LIVE_TEST_SPECIALIST_MODEL_ID": "gemini-3.1-pro-preview",
        "LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE": "generate-content",
        "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT": "low",
        "LIVE_TEST_SPECIALIST_REASONING_EFFORT": "low",
    },
    "openai-api": {
        "snapshot_heading": "OpenAI API",
        "LIVE_TEST_PROVIDER_AUTH_MODE": "api_key",
        "LIVE_TEST_PROVIDER_TYPE": "openai",
        "LIVE_TEST_PROVIDER_NAME": "OpenAI (API Key)",
        "LIVE_TEST_PROVIDER_BASE_URL": "https://api.openai.com/v1",
        "LIVE_TEST_SYSTEM_REASONING_EFFORT": "low",
        "LIVE_TEST_MODEL_ID": "gpt-5.4",
        "LIVE_TEST_MODEL_ENDPOINT_TYPE": "responses",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "gpt-5.4",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE": "responses",
        "LIVE_TEST_SPECIALIST_MODEL_ID": "gpt-5.4",
        "LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE": "responses",
        "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT": "low",
        "LIVE_TEST_SPECIALIST_REASONING_EFFORT": "low",
    },
    "openai-oauth": {
        "snapshot_heading": "OpenAI OAuth",
        "LIVE_TEST_PROVIDER_AUTH_MODE": "oauth",
        "LIVE_TEST_PROVIDER_TYPE": "openai",
        "LIVE_TEST_PROVIDER_NAME": "OpenAI (Subscription)",
        "LIVE_TEST_PROVIDER_BASE_URL": "https://chatgpt.com/backend-api",
        "LIVE_TEST_SYSTEM_REASONING_EFFORT": "low",
        "LIVE_TEST_MODEL_ID": "gpt-5.4",
        "LIVE_TEST_MODEL_ENDPOINT_TYPE": "responses",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ID": "gpt-5.4",
        "LIVE_TEST_ORCHESTRATOR_MODEL_ENDPOINT_TYPE": "responses",
        "LIVE_TEST_SPECIALIST_MODEL_ID": "gpt-5.4",
        "LIVE_TEST_SPECIALIST_MODEL_ENDPOINT_TYPE": "responses",
        "LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT": "low",
        "LIVE_TEST_SPECIALIST_REASONING_EFFORT": "low",
    },
}

SNAPSHOT_START = "# BEGIN LOCAL PROVIDER SNAPSHOTS"
SNAPSHOT_END = "# END LOCAL PROVIDER SNAPSHOTS"
SNAPSHOT_SECRET_KEYS = {
    "LIVE_TEST_PROVIDER_API_KEY",
    "LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID",
    "LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON",
}


def apply_provider_selection(
    provider_key: str | None,
    environ: dict[str, str] | None = None,
    *,
    env_file: Path | None = None,
) -> dict[str, str]:
    if provider_key is None:
        return {}
    target = environ if environ is not None else os.environ
    overrides = resolve_provider_env_overrides(provider_key, target, env_file=env_file)
    target.update(overrides)
    return overrides


def assert_provider_selection_matches(
    provider_key: str | None,
    bootstrap_context: Mapping[str, str | object],
    overrides: Mapping[str, str],
) -> None:
    if provider_key is None:
        return
    expected_auth_mode = str(overrides.get("LIVE_TEST_PROVIDER_AUTH_MODE") or "").strip()
    expected_provider_type = str(overrides.get("LIVE_TEST_PROVIDER_TYPE") or "").strip()
    expected_model_id = str(overrides.get("LIVE_TEST_MODEL_ID") or "").strip()
    expected_orchestrator_model = str(overrides.get("LIVE_TEST_ORCHESTRATOR_MODEL_ID") or "").strip()
    expected_specialist_model = str(overrides.get("LIVE_TEST_SPECIALIST_MODEL_ID") or "").strip()
    expected_system_reasoning = str(overrides.get("LIVE_TEST_SYSTEM_REASONING_EFFORT") or "").strip()
    expected_orchestrator_reasoning = str(overrides.get("LIVE_TEST_ORCHESTRATOR_REASONING_EFFORT") or "").strip()
    expected_specialist_reasoning = str(overrides.get("LIVE_TEST_SPECIALIST_REASONING_EFFORT") or "").strip()

    actual_auth_mode = str(bootstrap_context.get("provider_auth_mode") or "").strip()
    actual_provider_type = str(bootstrap_context.get("provider_type") or "").strip()
    actual_model_id = str(bootstrap_context.get("model_name") or "").strip()
    actual_orchestrator_model = str(bootstrap_context.get("orchestrator_model_name") or "").strip()
    actual_specialist_model = str(bootstrap_context.get("specialist_model_name") or "").strip()
    actual_system_reasoning = str(bootstrap_context.get("system_reasoning") or "").strip()
    actual_orchestrator_reasoning = str(bootstrap_context.get("orchestrator_reasoning") or "").strip()
    actual_specialist_reasoning = str(bootstrap_context.get("specialist_reasoning") or "").strip()

    mismatches = []
    if expected_auth_mode and actual_auth_mode != expected_auth_mode:
        mismatches.append(f"auth_mode expected {expected_auth_mode} got {actual_auth_mode}")
    if expected_provider_type and actual_provider_type != expected_provider_type:
        mismatches.append(f"provider_type expected {expected_provider_type} got {actual_provider_type}")
    if expected_model_id and actual_model_id != expected_model_id:
        mismatches.append(f"model expected {expected_model_id} got {actual_model_id}")
    if expected_orchestrator_model and actual_orchestrator_model != expected_orchestrator_model:
        mismatches.append(
            f"orchestrator model expected {expected_orchestrator_model} got {actual_orchestrator_model}"
        )
    if expected_specialist_model and actual_specialist_model != expected_specialist_model:
        mismatches.append(
            f"specialist model expected {expected_specialist_model} got {actual_specialist_model}"
        )
    if expected_system_reasoning and actual_system_reasoning != expected_system_reasoning:
        mismatches.append(
            f"system reasoning expected {expected_system_reasoning} got {actual_system_reasoning}"
        )
    if expected_orchestrator_reasoning and actual_orchestrator_reasoning != expected_orchestrator_reasoning:
        mismatches.append(
            f"orchestrator reasoning expected {expected_orchestrator_reasoning} got {actual_orchestrator_reasoning}"
        )
    if expected_specialist_reasoning and actual_specialist_reasoning != expected_specialist_reasoning:
        mismatches.append(
            f"specialist reasoning expected {expected_specialist_reasoning} got {actual_specialist_reasoning}"
        )
    if mismatches:
        raise RuntimeError(
            "selected provider bootstrap mismatch for "
            + provider_key
            + ": "
            + "; ".join(mismatches)
        )


def resolve_provider_env_overrides(
    provider_key: str,
    environ: Mapping[str, str],
    *,
    env_file: Path | None = None,
) -> dict[str, str]:
    normalized_key = provider_key.strip().lower()
    preset = PROVIDER_PRESETS.get(normalized_key)
    if preset is None:
        raise RuntimeError(f"unsupported provider selection: {provider_key}")

    snapshot_values = load_snapshot_section(
        env_file if env_file is not None else default_live_env_file(),
        str(preset["snapshot_heading"]),
    )

    overrides = {
        key: value
        for key, value in preset.items()
        if key != "snapshot_heading"
    }
    overrides.update(snapshot_values)

    if normalized_key == "anthropic" and not overrides.get("LIVE_TEST_PROVIDER_API_KEY"):
        overrides["LIVE_TEST_PROVIDER_API_KEY"] = read_required_secret(environ, "LIVE_TEST_ANTHROPIC_API_KEY")
    elif normalized_key == "gemini" and not overrides.get("LIVE_TEST_PROVIDER_API_KEY"):
        overrides["LIVE_TEST_PROVIDER_API_KEY"] = read_required_secret(environ, "LIVE_TEST_GEMINI_API_KEY")
    elif normalized_key == "openai-api" and not overrides.get("LIVE_TEST_PROVIDER_API_KEY"):
        overrides["LIVE_TEST_PROVIDER_API_KEY"] = read_required_secret(environ, "LIVE_TEST_OPENAI_API_KEY")
    elif normalized_key == "openai-oauth":
        if not overrides.get("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID"):
            overrides["LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID"] = read_required_secret(
                environ,
                "LIVE_TEST_OPENAI_OAUTH_PROFILE_ID",
                fallback_key="LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID",
            )
        if not overrides.get("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON"):
            overrides["LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON"] = read_required_secret(
                environ,
                "LIVE_TEST_OPENAI_OAUTH_SESSION_JSON",
                fallback_key="LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON",
            )

    if overrides.get("LIVE_TEST_PROVIDER_AUTH_MODE") == "api_key" and not overrides.get("LIVE_TEST_PROVIDER_API_KEY"):
        raise RuntimeError(f"provider {provider_key} requires LIVE_TEST_PROVIDER_API_KEY")

    if overrides.get("LIVE_TEST_PROVIDER_AUTH_MODE") == "oauth":
        if not overrides.get("LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID"):
            raise RuntimeError(f"provider {provider_key} requires LIVE_TEST_PROVIDER_OAUTH_PROFILE_ID")
        if not overrides.get("LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON"):
            raise RuntimeError(f"provider {provider_key} requires LIVE_TEST_PROVIDER_OAUTH_SESSION_JSON")

    return overrides


def default_live_env_file() -> Path:
    return live_root() / "env" / "local.env"


def read_required_secret(
    environ: Mapping[str, str],
    primary_key: str,
    *,
    fallback_key: str | None = None,
) -> str:
    candidate = str(environ.get(primary_key) or "").strip()
    if candidate:
        return candidate
    if fallback_key:
        fallback = str(environ.get(fallback_key) or "").strip()
        if fallback:
            return fallback
    raise RuntimeError(f"{primary_key} is required for provider selection")


def load_snapshot_section(env_file: Path, heading: str) -> dict[str, str]:
    if not env_file.is_file():
        return {}

    lines = env_file.read_text(encoding="utf-8").splitlines()
    in_snapshot_block = False
    capture = False
    values: dict[str, str] = {}

    for raw_line in lines:
        line = raw_line.rstrip()
        if line.strip() == SNAPSHOT_START:
            in_snapshot_block = True
            continue
        if line.strip() == SNAPSHOT_END:
            break
        if not in_snapshot_block:
            continue
        if line.strip() == f"# {heading}" or line.strip().startswith(f"# {heading} ("):
            capture = True
            continue
        if line.startswith("# ") and "=" not in line:
            capture = False
            continue
        if not capture:
            continue
        if not line.startswith("# ") or "=" not in line:
            continue
        key, value = line[2:].split("=", 1)
        normalized_key = key.strip()
        if normalized_key in SNAPSHOT_SECRET_KEYS:
            values[normalized_key] = value.strip()

    return values
