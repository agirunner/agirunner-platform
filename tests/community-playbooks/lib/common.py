#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, MutableMapping


SUITE_ROOT = Path(__file__).resolve().parents[1]
TESTS_ROOT = SUITE_ROOT.parent
REPO_ROOT = TESTS_ROOT.parent
LIVE_ROOT = TESTS_ROOT / "live"
LIVE_LIB = LIVE_ROOT / "lib"

if str(LIVE_LIB) not in sys.path:
    sys.path.insert(0, str(LIVE_LIB))

from live_test_api import ApiClient, TraceRecorder  # noqa: E402
from live_test_redaction import redact_json  # noqa: E402


def suite_root() -> Path:
    return SUITE_ROOT


def repo_root() -> Path:
    return REPO_ROOT


def live_root() -> Path:
    return LIVE_ROOT


def results_root() -> Path:
    return Path(os.environ.get("COMMUNITY_PLAYBOOKS_RESULTS_DIR", SUITE_ROOT / "results"))


def ensure_dir(path: str | Path) -> Path:
    resolved = Path(path)
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def read_json_file(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json_file(path: str | Path, payload: Any) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(redact_json(payload), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def relative_to_suite(path: str | Path) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return SUITE_ROOT / candidate


def read_env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def load_env_file_values(path: str | Path, *, environ: MutableMapping[str, str] | None = None) -> dict[str, str]:
    target = environ if environ is not None else os.environ
    values: dict[str, str] = {}
    for raw_line in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line == "" or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        key = name.strip()
        if key == "":
            continue
        resolved = value.strip()
        if len(resolved) >= 2:
            if (resolved[0], resolved[-1]) in {("'", "'"), ('"', '"')}:
                resolved = resolved[1:-1]
        target[key] = resolved
        values[key] = resolved
    return values


def run_command(
    args: list[str],
    *,
    cwd: str | Path | None = None,
    env: dict[str, str] | None = None,
    capture_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    final_env = os.environ.copy()
    if env:
        final_env.update(env)
    return subprocess.run(
        args,
        cwd=str(cwd) if cwd is not None else None,
        env=final_env,
        check=True,
        text=True,
        capture_output=capture_output,
    )


def create_api_client(*, trace_dir: str | Path | None = None) -> ApiClient:
    base_url = read_env("PLATFORM_API_BASE_URL", required=True)
    trace = TraceRecorder(str(ensure_dir(trace_dir))) if trace_dir is not None else None
    return ApiClient(base_url, trace)


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    fragments = []
    current = []
    for character in lowered:
        if character.isalnum():
            current.append(character)
            continue
        if current:
            fragments.append("".join(current))
            current = []
    if current:
        fragments.append("".join(current))
    return "-".join(fragment for fragment in fragments if fragment)
