#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fixture_support import (
    load_list_fixture,
    normalize_slug,
    read_optional_string,
    read_positive_int,
    read_required_string,
    request_data,
    resolve_scalar_value,
)


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
        saved = upsert_remote_mcp_server(client, slug=slug, payload=normalized, existing_item=existing_item)
        summary = summarize_remote_mcp_server(saved)
        items.append(summary)
        by_slug[summary["slug"]] = summary
    return {"items": items, "by_slug": by_slug}


def upsert_remote_mcp_server(
    client: Any,
    *,
    slug: str,
    payload: dict[str, Any],
    existing_item: dict[str, Any] | None,
) -> dict[str, Any]:
    if payload["authMode"] != "oauth":
        return upsert_standard_remote_mcp_server(client, slug=slug, payload=payload, existing_item=existing_item)
    if existing_item is None:
        return create_oauth_remote_mcp_server(client, slug=slug, payload=payload)
    if read_optional_string(existing_item.get("auth_mode")) != "oauth":
        raise RuntimeError(
            f"remote-mcp fixture {slug} is configured for oauth but existing server uses "
            f"{existing_item.get('auth_mode')!r}; reseed the live environment first",
        )
    if bool(existing_item.get("oauth_connected")):
        return request_data(
            client,
            "PUT",
            f"/api/v1/remote-mcp-servers/{existing_item['id']}",
            payload=payload,
            label=f"remote-mcp-servers.update:{slug}",
        )
    reconnect = request_data(
        client,
        "POST",
        f"/api/v1/remote-mcp-servers/{existing_item['id']}/oauth/reconnect",
        expected=(200,),
        label=f"remote-mcp-servers.reconnect:{slug}",
    )
    resolve_oauth_start_result(client, slug=slug, start_result=reconnect)
    return request_data(
        client,
        "PUT",
        f"/api/v1/remote-mcp-servers/{existing_item['id']}",
        payload=payload,
        label=f"remote-mcp-servers.update:{slug}",
    )


def upsert_standard_remote_mcp_server(
    client: Any,
    *,
    slug: str,
    payload: dict[str, Any],
    existing_item: dict[str, Any] | None,
) -> dict[str, Any]:
    if existing_item is None:
        return request_data(
            client,
            "POST",
            "/api/v1/remote-mcp-servers",
            payload=payload,
            expected=(200, 201),
            label=f"remote-mcp-servers.create:{slug}",
        )
    return request_data(
        client,
        "PUT",
        f"/api/v1/remote-mcp-servers/{existing_item['id']}",
        payload=payload,
        label=f"remote-mcp-servers.update:{slug}",
    )


def create_oauth_remote_mcp_server(client: Any, *, slug: str, payload: dict[str, Any]) -> dict[str, Any]:
    start_result = request_data(
        client,
        "POST",
        "/api/v1/remote-mcp-servers/oauth/authorize",
        payload=payload,
        expected=(200,),
        label=f"remote-mcp-servers.authorize:{slug}",
    )
    return resolve_oauth_start_result(client, slug=slug, start_result=start_result)


def resolve_oauth_start_result(client: Any, *, slug: str, start_result: dict[str, Any]) -> dict[str, Any]:
    kind = read_required_string(start_result.get("kind"), f"remote-mcp.oauth.{slug}.kind")
    if kind == "completed":
        server_id = read_required_string(start_result.get("serverId"), f"remote-mcp.oauth.{slug}.serverId")
        return request_data(
            client,
            "GET",
            f"/api/v1/remote-mcp-servers/{server_id}",
            label=f"remote-mcp-servers.get:{slug}",
        )
    if kind == "browser":
        raise RuntimeError(
            f"remote-mcp fixture {slug} requires interactive browser authorization; "
            "the live harness only auto-seeds completed OAuth flows",
        )
    if kind == "device":
        raise RuntimeError(
            f"remote-mcp fixture {slug} requires interactive device authorization; "
            "the live harness only auto-seeds completed OAuth flows",
        )
    raise RuntimeError(f"remote-mcp fixture {slug} returned unknown OAuth start result kind {kind!r}")


def normalize_remote_mcp_fixture(entry: dict[str, Any]) -> dict[str, Any]:
    auth_mode = read_required_string(entry.get("authMode"), "remote-mcp.authMode")
    if auth_mode not in {"none", "parameterized", "oauth"}:
        raise RuntimeError("remote-mcp.authMode must be one of: none, parameterized, oauth")

    payload = {
        "name": read_required_string(entry.get("name"), "remote-mcp.name"),
        "description": read_optional_string(entry.get("description")) or "",
        "endpointUrl": resolve_scalar_value(entry.get("endpointUrl"), "remote-mcp.endpointUrl"),
        "transportPreference": read_optional_string(entry.get("transportPreference")) or "auto",
        "callTimeoutSeconds": read_positive_int(
            entry.get("callTimeoutSeconds"),
            "remote-mcp.callTimeoutSeconds",
            default=300,
        ),
        "authMode": auth_mode,
        "enabledByDefaultForNewSpecialists": bool(entry.get("enabledByDefaultForNewSpecialists", False)),
        "grantToAllExistingSpecialists": bool(entry.get("grantToAllExistingSpecialists", False)),
        "parameters": normalize_remote_mcp_parameters(entry.get("parameters")),
    }
    oauth_definition = normalize_remote_mcp_oauth_definition(entry.get("oauthDefinition"), auth_mode=auth_mode)
    if oauth_definition is not None:
        payload["oauthDefinition"] = oauth_definition
    return payload


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
            },
        )
    return normalized


def normalize_remote_mcp_oauth_definition(value: Any, *, auth_mode: str) -> dict[str, Any] | None:
    if auth_mode != "oauth":
        return None
    if value is None:
        return None
    if not isinstance(value, dict):
        raise RuntimeError("remote-mcp.oauthDefinition must be an object")

    oauth_definition: dict[str, Any] = {}
    for key in (
        "grantType",
        "clientStrategy",
        "callbackMode",
        "tokenEndpointAuthMethod",
        "parMode",
        "jarMode",
    ):
        text = read_optional_string(value.get(key))
        if text:
            oauth_definition[key] = text

    for key in (
        "clientId",
        "clientSecret",
        "authorizationEndpointOverride",
        "tokenEndpointOverride",
        "registrationEndpointOverride",
        "deviceAuthorizationEndpointOverride",
        "protectedResourceMetadataUrlOverride",
        "authorizationServerMetadataUrlOverride",
        "privateKeyPem",
    ):
        resolved = normalize_optional_scalar(value.get(key), field_name=f"remote-mcp.oauthDefinition.{key}")
        if resolved is not None:
            oauth_definition[key] = resolved

    for key in ("scopes", "resourceIndicators", "audiences"):
        values = normalize_string_list(value.get(key), field_name=f"remote-mcp.oauthDefinition.{key}")
        if values:
            oauth_definition[key] = values

    enterprise_profile = normalize_optional_json_object(
        value.get("enterpriseProfile"),
        field_name="remote-mcp.oauthDefinition.enterpriseProfile",
    )
    if enterprise_profile is not None:
        oauth_definition["enterpriseProfile"] = enterprise_profile

    return oauth_definition or None


def summarize_remote_mcp_server(saved: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": saved["id"],
        "name": saved["name"],
        "slug": saved["slug"],
        "auth_mode": saved["auth_mode"],
        "verified_transport": saved["verified_transport"],
        "oauth_connected": bool(saved.get("oauth_connected")),
        "discovered_tool_names": summarize_tool_names(saved.get("discovered_tools_snapshot")),
    }


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


def normalize_optional_scalar(value: Any, *, field_name: str) -> str | None:
    if value is None:
        return None
    return resolve_scalar_value(value, field_name)


def normalize_string_list(value: Any, *, field_name: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [resolve_scalar_value(entry, f"{field_name}[{index}]") for index, entry in enumerate(value)]
    return [
        entry.strip()
        for entry in resolve_scalar_value(value, field_name).replace("\r", "").replace("\n", ",").split(",")
        if entry.strip()
    ]


def normalize_optional_json_object(value: Any, *, field_name: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return dict(value)
    parsed = json.loads(resolve_scalar_value(value, field_name))
    if not isinstance(parsed, dict):
        raise RuntimeError(f"{field_name} must resolve to a JSON object")
    return parsed
