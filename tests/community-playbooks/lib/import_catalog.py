#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from bootstrap import prepare_environment
from common import create_api_client, ensure_dir, read_env, results_root, write_json_file
from community_catalog_api import CommunityCatalogApi


def import_full_catalog(api: CommunityCatalogApi) -> dict[str, Any]:
    catalog_playbooks = api.list_catalog_playbooks()
    playbook_ids = [str(item.get("id") or "").strip() for item in catalog_playbooks]
    normalized_ids = [item for item in playbook_ids if item]
    if not normalized_ids:
        raise RuntimeError("community catalog did not return any playbooks")

    preview = api.preview_import(normalized_ids)
    imported = api.import_playbooks(normalized_ids)
    imported_playbooks = list(imported.get("importedPlaybooks") or [])
    imported_by_slug = {
        str(item.get("localSlug") or "").strip(): dict(item)
        for item in imported_playbooks
        if str(item.get("localSlug") or "").strip()
    }
    return {
        "catalog_playbook_count": len(catalog_playbooks),
        "catalog_playbooks": catalog_playbooks,
        "preview": preview,
        "import_result": imported,
        "imported_playbooks": imported_playbooks,
        "imported_by_slug": imported_by_slug,
    }


def create_catalog_api(trace_dir: str | Path) -> CommunityCatalogApi:
    admin_api_key = read_env("DEFAULT_ADMIN_API_KEY", required=True)
    public_client = create_api_client(trace_dir=trace_dir)
    authed_client = CommunityCatalogApi(public_client).login(admin_api_key)
    return CommunityCatalogApi(authed_client)


def assign_specialist_model_to_roles(
    api: CommunityCatalogApi,
    *,
    specialist_model_id: str,
    reasoning_effort: str,
) -> list[dict[str, Any]]:
    assignments: list[dict[str, Any]] = []
    for role in api.list_roles():
        role_name = str(role.get("name") or "").strip()
        if not role_name:
            continue
        assignments.append(
            api.upsert_role_assignment(
                role_name,
                primary_model_id=specialist_model_id,
                reasoning_effort=reasoning_effort,
            )
        )
    return assignments


def run_import_only(
    *,
    prepare_environment_fn=prepare_environment,
    api_factory=create_catalog_api,
    output_path: str | Path | None = None,
) -> dict[str, Any]:
    bootstrap_context = prepare_environment_fn()
    trace_dir = ensure_dir(results_root() / "import" / "api-trace")
    api = api_factory(trace_dir)
    import_payload = import_full_catalog(api)
    role_assignments = assign_specialist_model_to_roles(
        api,
        specialist_model_id=str(bootstrap_context["specialist_model_id"]),
        reasoning_effort=str(bootstrap_context["specialist_reasoning"]),
    )
    payload = {
        **import_payload,
        "bootstrap_context": bootstrap_context,
        "role_assignments": role_assignments,
    }
    write_json_file(output_path or results_root() / "import" / "import-summary.json", payload)
    return payload
