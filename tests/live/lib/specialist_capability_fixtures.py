#!/usr/bin/env python3
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from live_test_api import read_json


def sync_profile_capabilities(client: Any, *, profile_dir: Path) -> dict[str, Any]:
    skills = sync_specialist_skills(client, profile_dir / "skills.json")
    remote_mcp_servers = sync_remote_mcp_servers(client, profile_dir / "remote-mcp-servers.json")
    return {
        "skills": skills["items"],
        "skills_by_slug": skills["by_slug"],
        "remote_mcp_servers": remote_mcp_servers["items"],
        "remote_mcp_servers_by_slug": remote_mcp_servers["by_slug"],
    }


def resolve_role_capability_refs(
    payload: dict[str, Any],
    *,
    registry: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, list[str]]]:
    resolved = dict(payload)
    skill_slugs = resolve_slug_list(
        resolved.pop("skillSlugs", []),
        field_name="skillSlugs",
        registry=registry.get("skills_by_slug", {}),
        target_field="skillIds",
        payload=resolved,
    )
    mcp_server_slugs = resolve_slug_list(
        resolved.pop("mcpServerSlugs", []),
        field_name="mcpServerSlugs",
        registry=registry.get("remote_mcp_servers_by_slug", {}),
        target_field="mcpServerIds",
        payload=resolved,
    )
    return resolved, {
        "skill_slugs": skill_slugs,
        "mcp_server_slugs": mcp_server_slugs,
    }


def sync_specialist_skills(client: Any, fixture_path: Path) -> dict[str, Any]:
    fixture_items = load_list_fixture(fixture_path)
    if not fixture_items:
        return {"items": [], "by_slug": {}}
    existing = request_data(client, "GET", "/api/v1/specialist-skills", label="specialist-skills.list")
    existing_by_slug = {
        str(item.get("slug") or "").strip(): item
        for item in existing
        if isinstance(item, dict)
    }
    items: list[dict[str, Any]] = []
    by_slug: dict[str, dict[str, Any]] = {}
    for entry in fixture_items:
        normalized = normalize_skill_fixture(entry)
        slug = normalized["slug"]
        existing_item = existing_by_slug.get(slug)
        if existing_item is None:
            saved = request_data(
                client,
                "POST",
                "/api/v1/specialist-skills",
                payload=normalized,
                label=f"specialist-skills.create:{slug}",
            )
        else:
            saved = request_data(
                client,
                "PUT",
                f"/api/v1/specialist-skills/{existing_item['id']}",
                payload=normalized,
                label=f"specialist-skills.update:{slug}",
            )
        summary = {
            "id": saved["id"],
            "name": saved["name"],
            "slug": saved["slug"],
        }
        items.append(summary)
        by_slug[summary["slug"]] = summary
    return {"items": items, "by_slug": by_slug}


def sync_remote_mcp_servers(client: Any, fixture_path: Path) -> dict[str, Any]:
    fixture_items = load_list_fixture(fixture_path)
    if not fixture_items:
        return {"items": [], "by_slug": {}}
    existing = request_data(client, "GET", "/api/v1/remote-mcp-servers", label="remote-mcp-servers.list")
    existing_by_slug = {
        str(item.get("slug") or "").strip(): item
        for item in existing
        if isinstance(item, dict)
    }
    items: list[dict[str, Any]] = []
    by_slug: dict[str, dict[str, Any]] = {}
    for entry in fixture_items:
        normalized = normalize_remote_mcp_fixture(entry)
        slug = normalize_slug(normalized["name"])
        existing_item = existing_by_slug.get(slug)
        if existing_item is None:
            saved = request_data(
                client,
                "POST",
                "/api/v1/remote-mcp-servers",
                payload=normalized,
                label=f"remote-mcp-servers.create:{slug}",
            )
        else:
            saved = request_data(
                client,
                "PUT",
                f"/api/v1/remote-mcp-servers/{existing_item['id']}",
                payload=normalized,
                label=f"remote-mcp-servers.update:{slug}",
            )
        summary = {
            "id": saved["id"],
            "name": saved["name"],
            "slug": saved["slug"],
            "auth_mode": saved["auth_mode"],
            "verified_transport": saved["verified_transport"],
            "discovered_tool_names": summarize_tool_names(saved.get("discovered_tools_snapshot")),
        }
        items.append(summary)
        by_slug[summary["slug"]] = summary
    return {"items": items, "by_slug": by_slug}


def request_data(
    client: Any,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    label: str | None = None,
) -> Any:
    response = client.request(method, path, payload=payload, label=label)
    if not isinstance(response, dict) or "data" not in response:
        raise RuntimeError(f"unexpected response payload: {response!r}")
    return response["data"]


def load_list_fixture(fixture_path: Path) -> list[dict[str, Any]]:
    if not fixture_path.is_file():
        return []
    payload = read_json(fixture_path)
    if not isinstance(payload, list):
        raise RuntimeError(f"{fixture_path} must contain a JSON array")
    return [dict(entry) for entry in payload if isinstance(entry, dict)]


def normalize_skill_fixture(entry: dict[str, Any]) -> dict[str, Any]:
    name = read_required_string(entry.get("name"), "skills.name")
    slug = normalize_slug(read_optional_string(entry.get("slug")) or name)
    summary = read_required_string(entry.get("summary"), "skills.summary")
    content = read_required_string(entry.get("content"), "skills.content")
    return {
        "name": name,
        "slug": slug,
        "summary": summary,
        "content": content,
    }


def normalize_remote_mcp_fixture(entry: dict[str, Any]) -> dict[str, Any]:
    auth_mode = read_required_string(entry.get("authMode"), "remote-mcp.authMode")
    if auth_mode not in {"none", "parameterized", "oauth"}:
        raise RuntimeError(f"remote-mcp.authMode must be one of: none, parameterized, oauth")
    return {
        "name": read_required_string(entry.get("name"), "remote-mcp.name"),
        "description": read_optional_string(entry.get("description")) or "",
        "endpointUrl": resolve_scalar_value(entry.get("endpointUrl"), "remote-mcp.endpointUrl"),
        "authMode": auth_mode,
        "enabledByDefaultForNewSpecialists": bool(entry.get("enabledByDefaultForNewSpecialists", False)),
        "grantToAllExistingSpecialists": bool(entry.get("grantToAllExistingSpecialists", False)),
        "parameters": normalize_remote_mcp_parameters(entry.get("parameters")),
    }


def normalize_remote_mcp_parameters(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RuntimeError("remote-mcp.parameters must be an array")
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(value):
        if not isinstance(entry, dict):
            raise RuntimeError(f"remote-mcp.parameters[{index}] must be an object")
        normalized.append(
            {
                "placement": read_required_string(entry.get("placement"), f"remote-mcp.parameters[{index}].placement"),
                "key": read_required_string(entry.get("key"), f"remote-mcp.parameters[{index}].key"),
                "valueKind": read_required_string(entry.get("valueKind"), f"remote-mcp.parameters[{index}].valueKind"),
                "value": resolve_scalar_value(entry.get("value"), f"remote-mcp.parameters[{index}].value"),
            }
        )
    return normalized


def resolve_slug_list(
    value: Any,
    *,
    field_name: str,
    registry: dict[str, dict[str, Any]],
    target_field: str,
    payload: dict[str, Any],
) -> list[str]:
    if value in (None, []):
        return []
    if not isinstance(value, list):
        raise RuntimeError(f"{field_name} must be an array")
    slugs: list[str] = []
    resolved_ids = list(payload.get(target_field, [])) if isinstance(payload.get(target_field), list) else []
    for index, entry in enumerate(value):
        slug = read_required_string(entry, f"{field_name}[{index}]")
        resolved = registry.get(slug)
        if not isinstance(resolved, dict):
            raise RuntimeError(f"unknown {field_name} entry: {slug}")
        slugs.append(slug)
        resolved_ids.append(resolved["id"])
    payload[target_field] = resolved_ids
    return slugs


def resolve_scalar_value(value: Any, field_name: str) -> str:
    if isinstance(value, str):
        resolved = value.strip()
        if resolved == "":
            raise RuntimeError(f"{field_name} must not be empty")
        return resolved
    if isinstance(value, dict):
        env_name = read_optional_string(value.get("env"))
        if env_name:
            return read_env_value(env_name, field_name)
        template = read_optional_string(value.get("template"))
        if template:
            return substitute_env_template(template, field_name)
    raise RuntimeError(f"{field_name} must be a string or an env/template object")


def substitute_env_template(value: str, field_name: str) -> str:
    def replace(match: re.Match[str]) -> str:
        env_name = match.group(1)
        return read_env_value(env_name, field_name)

    resolved = re.sub(r"\$\{([A-Z0-9_]+)\}", replace, value)
    if resolved.strip() == "":
        raise RuntimeError(f"{field_name} resolved to an empty value")
    return resolved.strip()


def read_env_value(name: str, field_name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value == "":
        raise RuntimeError(f"{field_name} requires environment variable {name}")
    return value


def summarize_tool_names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        for key in ("original_name", "name"):
            name = read_optional_string(entry.get(key))
            if name:
                names.append(name)
                break
    return sorted(set(names))


def read_required_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise RuntimeError(f"{field_name} is required")
    return value.strip()


def read_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def normalize_slug(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.strip().lower())).strip("-")
