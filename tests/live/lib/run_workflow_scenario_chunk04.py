#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk03 import *

def _workflow_events(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _stage_gates(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def _workflow_tasks(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = workflow.get("tasks", [])
    return tasks if isinstance(tasks, list) else []


def _task_rows(snapshot: Any) -> list[dict[str, Any]]:
    if not isinstance(snapshot, dict):
        return []
    data = snapshot.get("data", [])
    return data if isinstance(data, list) else []


def _task_page_count(snapshot: Any) -> int:
    if not isinstance(snapshot, dict):
        return 1
    meta = snapshot.get("meta", {})
    if not isinstance(meta, dict):
        return 1
    pages = meta.get("pages")
    return pages if isinstance(pages, int) and pages > 0 else 1


def fetch_workflow_tasks(
    client: ApiClient,
    *,
    workflow_id: str,
    per_page: int = TASK_LIST_PER_PAGE,
) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        snapshot = client.request(
            "GET",
            f"/api/v1/tasks?workflow_id={workflow_id}&page={page}&per_page={per_page}",
            expected=(200,),
            label=f"tasks.list:{page}",
        )
        tasks.extend(_task_rows(snapshot))
        total_pages = _task_page_count(snapshot)
        page += 1
    return tasks


def attach_workflow_tasks(workflow: dict[str, Any], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    if not tasks:
        return workflow
    return {
        **workflow,
        "tasks": tasks,
    }


def _live_container_rows(snapshot: Any) -> list[dict[str, Any]]:
    data = _nested_data(snapshot)
    return data if isinstance(data, list) else []


def new_container_observations() -> dict[str, Any]:
    return {"rows": [], "_keys": set()}


def observe_live_containers(observations: dict[str, Any], snapshot: Any) -> None:
    rows = observations.get("rows")
    keys = observations.get("_keys")
    if not isinstance(rows, list) or not isinstance(keys, set):
        return
    for row in _live_container_rows(snapshot):
        if not isinstance(row, dict):
            continue
        normalized = dict(row)
        key = json.dumps(normalized, sort_keys=True, default=str)
        if key in keys:
            continue
        keys.add(key)
        normalized["observed_at"] = now_timestamp()
        rows.append(normalized)


def finalize_container_observations(observations: dict[str, Any]) -> dict[str, Any]:
    rows = observations.get("rows")
    if not isinstance(rows, list):
        return {"rows": [], "row_count": 0}
    return {"rows": [row for row in rows if isinstance(row, dict)], "row_count": len(rows)}


def container_observation_rows(observations: Any) -> list[dict[str, Any]]:
    if not isinstance(observations, dict):
        return []
    rows = observations.get("rows", [])
    return rows if isinstance(rows, list) else []


def _runtime_container_rows(snapshot: Any) -> list[dict[str, Any]]:
    return [
        row
        for row in _live_container_rows(snapshot)
        if isinstance(row, dict) and row.get("kind") in {"orchestrator", "runtime"}
    ]


def _relevant_workspace_entries(entries: list[str], *, relevant_task_ids: set[str] | None) -> list[str]:
    if not relevant_task_ids:
        return entries
    relevant_entry_names = {f"task-{task_id}" for task_id in relevant_task_ids}
    return [entry for entry in entries if entry in relevant_entry_names]


def collect_live_container_snapshot(client: ApiClient, *, label: str) -> dict[str, Any]:
    return client.best_effort_request(
        "GET",
        "/api/v1/fleet/live-containers",
        expected=(200,),
        label=label,
    )


def inspect_runtime_cleanup(
    snapshot: Any,
    *,
    trace: TraceRecorder | None = None,
    relevant_task_ids: set[str] | None = None,
) -> dict[str, Any]:
    runtime_rows = _runtime_container_rows(snapshot)
    inspections: list[dict[str, Any]] = []
    all_clean = len(runtime_rows) > 0
    for row in runtime_rows:
        container_id = row.get("container_id")
        if not isinstance(container_id, str) or container_id.strip() == "":
            all_clean = False
            continue
        try:
            output = docker_exec_text(
                container_id.strip(),
                "if [ -d /tmp/workspace ]; then ls -A /tmp/workspace; fi",
                trace=trace,
            )
            entries = [line.strip() for line in output.splitlines() if line.strip()]
            relevant_entries = _relevant_workspace_entries(entries, relevant_task_ids=relevant_task_ids)
            clean = len(relevant_entries) == 0
        except Exception as error:
            entries = []
            relevant_entries = []
            clean = False
            inspections.append(
                {
                    "container_id": container_id.strip(),
                    "kind": row.get("kind"),
                    "execution_backend": row.get("execution_backend"),
                    "clean": False,
                    "error": str(error),
                    "workspace_entries": entries,
                    "relevant_workspace_entries": relevant_entries,
                }
            )
            all_clean = False
            continue
        inspections.append(
            {
                "container_id": container_id.strip(),
                "kind": row.get("kind"),
                "execution_backend": row.get("execution_backend"),
                "clean": clean,
                "workspace_entries": entries,
                "relevant_workspace_entries": relevant_entries,
            }
        )
        all_clean = all_clean and clean
    return {"all_clean": all_clean, "runtime_containers": inspections}


def inspect_docker_log_rotation(snapshot: Any, *, trace: TraceRecorder | None = None) -> dict[str, Any]:
    runtime_rows = _runtime_container_rows(snapshot)
    inspections: list[dict[str, Any]] = []
    all_bounded = len(runtime_rows) > 0
    for row in runtime_rows:
        container_id = row.get("container_id")
        if not isinstance(container_id, str) or container_id.strip() == "":
            all_bounded = False
            continue
        try:
            inspect_payload = docker_inspect_json(container_id.strip(), trace=trace)
            host_config = inspect_payload.get("HostConfig", {})
            log_config = host_config.get("LogConfig", {}) if isinstance(host_config, dict) else {}
            config = log_config.get("Config", {}) if isinstance(log_config, dict) else {}
            driver = str(log_config.get("Type") or "").strip() if isinstance(log_config, dict) else ""
            bounded = (
                driver != ""
                and isinstance(config, dict)
                and str(config.get("max-size") or "").strip() != ""
                and str(config.get("max-file") or "").strip() != ""
            )
            inspections.append(
                {
                    "container_id": container_id.strip(),
                    "kind": row.get("kind"),
                    "execution_backend": row.get("execution_backend"),
                    "driver": driver,
                    "config": config if isinstance(config, dict) else {},
                    "bounded": bounded,
                }
            )
            all_bounded = all_bounded and bounded
        except Exception as error:
            inspections.append(
                {
                    "container_id": container_id.strip(),
                    "kind": row.get("kind"),
                    "execution_backend": row.get("execution_backend"),
                    "bounded": False,
                    "error": str(error),
                }
            )
            all_bounded = False
    return {"all_runtime_containers_bounded": all_bounded, "runtime_containers": inspections}


def settle_final_live_container_evidence(
    client: ApiClient,
    *,
    max_attempts: int,
    delay_seconds: int,
    trace: TraceRecorder | None,
    live_container_observations: dict[str, Any] | None = None,
    relevant_task_ids: set[str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    latest_live_containers: dict[str, Any] = {"ok": False, "error": "live container snapshot not collected"}
    runtime_cleanup: dict[str, Any] = {"all_clean": False, "error": "runtime cleanup not inspected"}
    docker_log_rotation: dict[str, Any] = {
        "all_runtime_containers_bounded": False,
        "error": "docker log rotation not inspected",
    }

    attempts = max(1, max_attempts)
    for attempt in range(attempts):
        latest_live_containers = collect_live_container_snapshot(client, label="containers.list.final")
        if latest_live_containers.get("ok"):
            if live_container_observations is not None:
                observe_live_containers(live_container_observations, latest_live_containers.get("data"))
            runtime_cleanup = inspect_runtime_cleanup(
                latest_live_containers.get("data"),
                trace=trace,
                relevant_task_ids=relevant_task_ids,
            )
            docker_log_rotation = inspect_docker_log_rotation(latest_live_containers.get("data"), trace=trace)
            if bool(runtime_cleanup.get("all_clean")):
                return latest_live_containers, runtime_cleanup, docker_log_rotation
        else:
            runtime_cleanup = {"all_clean": False, "error": latest_live_containers.get("error")}
            docker_log_rotation = {
                "all_runtime_containers_bounded": False,
                "error": latest_live_containers.get("error"),
            }
        if attempt + 1 < attempts:
            time.sleep(delay_seconds)

    return latest_live_containers, runtime_cleanup, docker_log_rotation

__all__ = [name for name in globals() if not name.startswith("__")]
