#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from typing import Any


class CommandError(RuntimeError):
    pass


def run_command(
    command: list[str],
    *,
    label: str,
    trace: Any | None = None,
) -> str:
    if trace is not None:
        trace.record({"event": "shell.command", "label": label, "command": command})
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if trace is not None:
        trace.record(
            {
                "event": "shell.result",
                "label": label,
                "command": command,
                "returncode": result.returncode,
                "stdout_preview": stdout[:512],
                "stderr_preview": stderr[:512],
            }
        )
    if result.returncode != 0:
        message = f"{label} failed with exit code {result.returncode}"
        if stderr:
            message += f": {stderr}"
        raise CommandError(message)
    return stdout


def docker_compose_psql_json(
    *,
    compose_file: str,
    compose_project_name: str,
    postgres_user: str,
    postgres_db: str,
    sql: str,
    trace: Any | None = None,
) -> Any:
    stdout = run_command(
        [
            "docker",
            "compose",
            "-p",
            compose_project_name,
            "-f",
            compose_file,
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            postgres_user,
            "-d",
            postgres_db,
            "-At",
            "-c",
            sql,
        ],
        label="docker_compose_psql_json",
        trace=trace,
    )
    if stdout == "":
        raise CommandError("docker_compose_psql_json returned empty output")
    return json.loads(stdout)


def docker_inspect_json(container_id: str, *, trace: Any | None = None) -> dict[str, Any]:
    stdout = run_command(
        ["docker", "inspect", container_id],
        label=f"docker_inspect:{container_id}",
        trace=trace,
    )
    payload = json.loads(stdout)
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
        raise CommandError(f"docker_inspect:{container_id} returned invalid payload")
    return payload[0]


def docker_exec_text(
    container_id: str,
    shell_command: str,
    *,
    trace: Any | None = None,
) -> str:
    return run_command(
        ["docker", "exec", container_id, "sh", "-lc", shell_command],
        label=f"docker_exec:{container_id}",
        trace=trace,
    )
