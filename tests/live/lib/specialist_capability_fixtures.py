#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from fixture_support import (
    load_list_fixture,
    normalize_slug,
    read_required_string,
    request_data,
)
from remote_mcp_fixture_sync import sync_remote_mcp_servers


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
                expected=(200, 201),
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


def normalize_skill_fixture(entry: dict[str, Any]) -> dict[str, Any]:
    name = read_required_string(entry.get("name"), "skills.name")
    slug = normalize_slug(str(entry.get("slug") or name))
    summary = read_required_string(entry.get("summary"), "skills.summary")
    content = read_required_string(entry.get("content"), "skills.content")
    return {
        "name": name,
        "slug": slug,
        "summary": summary,
        "content": content,
    }


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
