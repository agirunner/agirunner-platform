#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from bootstrap import prepare_environment
from common import ensure_dir, results_root, suite_root, write_json_file
from community_mcp import configure_community_mcp_servers
from community_run_api import CommunityRunApi
from import_catalog import assign_specialist_model_to_roles, create_catalog_api, import_full_catalog, run_import_only
from provider_selection import apply_provider_selection, assert_provider_selection_matches
from resolve_metadata import METADATA_FILE, load_metadata, resolve_run_specs, validate_metadata
from run_execution import execute_runs


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tests/community-playbooks/run.sh", add_help=True)
    parser.add_argument("--bootstrap-only", action="store_true")
    parser.add_argument("--import-only", action="store_true")
    parser.add_argument("--batch", action="append", choices=["smoke", "matrix", "controls"])
    parser.add_argument("--playbook")
    parser.add_argument("--variant")
    parser.add_argument("--provider", choices=["anthropic", "gemini", "openai-api", "openai-oauth"])
    parser.add_argument("--manual-operator-actions", action="store_true")
    parser.add_argument("--failed-only", action="store_true")
    return parser


def resolve_failed_only_ids(summary_path: Path) -> set[str]:
    if not summary_path.is_file():
        return set()
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    runs = payload.get("runs", [])
    return {
        str(item.get("id") or "").strip()
        for item in runs
        if isinstance(item, dict) and item.get("passed") is False
    }


def execute(args: argparse.Namespace) -> dict[str, Any]:
    selected_provider = getattr(args, "provider", None)
    provider_overrides = apply_provider_selection(selected_provider, os.environ)
    summary_path = results_root() / "summary.json"
    resolved_runs: list[dict[str, Any]] = []

    payload: dict[str, Any] = {
        "suite_root": str(suite_root()),
        "metadata_file": str(METADATA_FILE),
        "selected_batches": args.batch or ["smoke", "matrix", "controls"],
        "playbook": args.playbook,
        "variant": args.variant,
        "provider": selected_provider,
        "bootstrap_only": args.bootstrap_only,
        "import_only": args.import_only,
        "manual_operator_actions": args.manual_operator_actions,
        "failed_only": args.failed_only,
        "resolved_run_count": len(resolved_runs),
        "provider_overrides": sorted(provider_overrides.keys()),
    }

    if args.bootstrap_only:
        return {"bootstrap": prepare_environment(), "selection": payload}

    if args.import_only:
        return {"import": run_import_only(), "selection": payload}

    bootstrap_context = prepare_environment()
    assert_provider_selection_matches(selected_provider, bootstrap_context, provider_overrides)
    trace_dir = ensure_dir(results_root() / "suite" / "api-trace")
    api = CommunityRunApi(create_catalog_api(trace_dir).client)
    import_payload = import_full_catalog(api)
    role_assignments = assign_specialist_model_to_roles(
        api,
        specialist_model_id=str(bootstrap_context["specialist_model_id"]),
        reasoning_effort=str(bootstrap_context["specialist_reasoning"]),
    )
    remote_mcp_servers = configure_community_mcp_servers(api.client)
    write_json_file(
        results_root() / "import" / "import-summary.json",
        {
            **import_payload,
            "bootstrap_context": bootstrap_context,
            "role_assignments": role_assignments,
            "remote_mcp_servers": remote_mcp_servers,
        },
    )
    metadata = load_metadata(str(METADATA_FILE))
    validate_metadata(metadata)
    failed_only_ids = resolve_failed_only_ids(summary_path) if args.failed_only else None
    resolved_runs = resolve_run_specs(
        metadata,
        selected_batches=args.batch,
        playbook_slug=args.playbook,
        variant=args.variant,
        failed_only_ids=failed_only_ids,
    )
    payload["resolved_run_count"] = len(resolved_runs)
    local_playbooks = {
        str(playbook.get("slug") or "").strip(): dict(playbook)
        for playbook in api.list_local_playbooks()
        if str(playbook.get("slug") or "").strip()
    }
    run_result = execute_runs(
        api,
        local_playbooks,
        resolved_runs,
        results_dir=results_root(),
        manual_operator_actions=args.manual_operator_actions,
    )
    result = {
        "bootstrap": bootstrap_context,
        "import": {
            **import_payload,
            "role_assignments": role_assignments,
            "remote_mcp_servers": remote_mcp_servers,
        },
        **run_result,
        "selection": payload,
    }
    write_json_file(summary_path, result)
    return result


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    execute(args)


if __name__ == "__main__":
    main()
