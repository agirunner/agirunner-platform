#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from typing import Any

from live_test_api import ApiClient, TraceRecorder, read_json

TERMINAL_STATES = {"completed", "failed", "cancelled"}


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and (value is None or value.strip() == ""):
        raise RuntimeError(f"{name} is required")
    return (value or "").strip()


def env_int(name: str, default: int) -> int:
    value = env(name, str(default))
    return int(value)


def extract_data(response: Any) -> Any:
    if not isinstance(response, dict) or "data" not in response:
        raise RuntimeError(f"unexpected response payload: {response!r}")
    return response["data"]


def login(client: ApiClient, admin_api_key: str) -> str:
    response = client.request(
        "POST",
        "/api/v1/auth/login",
        payload={"api_key": admin_api_key},
        expected=(200,),
        label="auth.login",
    )
    data = extract_data(response)
    token = data.get("token")
    if not isinstance(token, str) or token.strip() == "":
        raise RuntimeError("auth login did not return a token")
    return token


def main() -> None:
    base_url = env("PLATFORM_API_BASE_URL", required=True)
    trace_dir = env("LIVE_TEST_SCENARIO_TRACE_DIR", required=True)
    admin_api_key = env("DEFAULT_ADMIN_API_KEY", required=True)
    bootstrap_context_file = env("LIVE_TEST_BOOTSTRAP_CONTEXT_FILE", required=True)
    workflow_name = env("LIVE_TEST_WORKFLOW_NAME", required=True)
    scenario_name = env("LIVE_TEST_SCENARIO_NAME", required=True)
    timeout_seconds = env_int("LIVE_TEST_WORKFLOW_TIMEOUT_SECONDS", 1800)
    poll_interval_seconds = env_int("LIVE_TEST_POLL_INTERVAL_SECONDS", 10)

    bootstrap_context = read_json(bootstrap_context_file)
    workspace_id = env("LIVE_TEST_WORKSPACE_ID", bootstrap_context["workspace_id"], required=True)
    playbook_id = env("LIVE_TEST_PLAYBOOK_ID", bootstrap_context["playbook_id"], required=True)

    trace = TraceRecorder(trace_dir)
    public_client = ApiClient(base_url, trace)
    auth_token = login(public_client, admin_api_key)
    client = public_client.with_bearer_token(auth_token)

    created = extract_data(
        client.request(
            "POST",
            "/api/v1/workflows",
            payload={
                "playbook_id": playbook_id,
                "workspace_id": workspace_id,
                "name": workflow_name,
                "parameters": {"scenario_name": scenario_name},
                "metadata": {"live_test": {"scenario_name": scenario_name}},
            },
            expected=(201,),
            label="workflows.create",
        )
    )

    workflow_id = created["id"]
    deadline = time.time() + timeout_seconds
    latest_workflow = created
    poll_iterations = 0

    while time.time() < deadline:
        poll_iterations += 1
        latest_workflow = extract_data(
            client.request(
                "GET",
                f"/api/v1/workflows/{workflow_id}",
                expected=(200,),
                label="workflows.get",
            )
        )
        if latest_workflow.get("state") in TERMINAL_STATES:
            break
        time.sleep(poll_interval_seconds)

    board_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/board",
        expected=(200,),
        label="workflows.board",
    )
    work_items_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/work-items",
        expected=(200,),
        label="workflows.work-items",
    )
    events_snapshot = client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/events",
        expected=(200,),
        label="workflows.events",
    )

    final_state = latest_workflow.get("state")
    print(
        json.dumps(
            {
                "workflow_id": workflow_id,
                "state": final_state,
                "terminal": final_state in TERMINAL_STATES,
                "timed_out": final_state not in TERMINAL_STATES,
                "poll_iterations": poll_iterations,
                "scenario_name": scenario_name,
                "workflow": latest_workflow,
                "board": board_snapshot,
                "work_items": work_items_snapshot,
                "events": events_snapshot,
            }
        )
    )


if __name__ == "__main__":
    main()
