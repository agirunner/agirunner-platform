#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from common import ensure_dir, results_root, suite_root, write_json_file
from resolve_metadata import METADATA_FILE, load_metadata, resolve_run_specs, validate_metadata


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tests/community-playbooks/run.sh", add_help=True)
    parser.add_argument("--bootstrap-only", action="store_true")
    parser.add_argument("--import-only", action="store_true")
    parser.add_argument("--batch", action="append", choices=["smoke", "matrix", "controls"])
    parser.add_argument("--playbook")
    parser.add_argument("--variant")
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


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    summary_path = results_root() / "summary.json"
    resolved_runs: list[dict[str, Any]] = []

    payload: dict[str, Any] = {
        "suite_root": str(suite_root()),
        "metadata_file": str(METADATA_FILE),
        "selected_batches": args.batch or ["smoke", "matrix", "controls"],
        "playbook": args.playbook,
        "variant": args.variant,
        "bootstrap_only": args.bootstrap_only,
        "import_only": args.import_only,
        "failed_only": args.failed_only,
        "resolved_run_count": len(resolved_runs),
    }

    if args.bootstrap_only:
        ensure_dir(results_root() / "bootstrap")
        write_json_file(results_root() / "bootstrap" / "plan.json", payload)
        return

    if args.import_only:
        ensure_dir(results_root() / "import")
        write_json_file(results_root() / "import" / "plan.json", payload)
        return

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

    write_json_file(summary_path, {"runs": resolved_runs, "selection": payload})


if __name__ == "__main__":
    main()
