#!/usr/bin/env python3
from __future__ import annotations
from run_workflow_scenario_chunk10 import *

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


def normalize_playbook_launch_inputs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    launch_inputs: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        slug = str(entry.get("slug") or "").strip()
        title = str(entry.get("title") or "").strip()
        if slug == "" or title == "":
            continue
        launch_inputs.append(
            {
                "slug": slug,
                "title": title,
                "required": bool(entry.get("required", False)),
            }
        )
    return launch_inputs


def build_declared_workflow_parameters(
    *,
    playbook_launch_inputs: list[dict[str, Any]],
    scenario_name: str,
    workflow_goal: str,
    workflow_parameters: dict[str, Any] | None,
) -> dict[str, str]:
    declared_inputs = normalize_playbook_launch_inputs(playbook_launch_inputs)
    provided_parameters = {} if workflow_parameters is None else dict(workflow_parameters)
    declared_slugs = {entry["slug"] for entry in declared_inputs}
    parameters = {
        key: value
        for key, value in provided_parameters.items()
        if key in declared_slugs
    }

    if "goal" in declared_slugs and "goal" not in parameters:
        parameters["goal"] = workflow_goal
    if "scenario_name" in declared_slugs and "scenario_name" not in parameters:
        parameters["scenario_name"] = scenario_name

    normalized: dict[str, str] = {}
    for entry in declared_inputs:
        slug = entry["slug"]
        value = parameters.get(slug)
        trimmed = value.strip() if isinstance(value, str) else ""
        if trimmed:
            normalized[slug] = trimmed
            continue
        if bool(entry.get("required", False)):
            raise RuntimeError(f"missing required playbook launch input slug: {slug}")
    return normalized


def build_workflow_create_payload(
    *,
    playbook_id: str,
    workspace_id: str,
    workflow_name: str,
    scenario_name: str,
    workflow_goal: str,
    playbook_launch_inputs: list[dict[str, Any]] | None = None,
    workflow_parameters: dict[str, Any] | None = None,
    workflow_metadata: dict[str, Any] | None = None,
    execution_environment: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "playbook_id": playbook_id,
        "workspace_id": workspace_id,
        "name": workflow_name,
        "parameters": build_declared_workflow_parameters(
            playbook_launch_inputs=[] if playbook_launch_inputs is None else playbook_launch_inputs,
            scenario_name=scenario_name,
            workflow_goal=workflow_goal,
            workflow_parameters=workflow_parameters,
        ),
        "metadata": {
            **({} if workflow_metadata is None else workflow_metadata),
            "live_test": {
                "scenario_name": scenario_name,
                **(
                    {}
                    if execution_environment is None
                    else {"execution_environment": execution_environment}
                ),
            },
        },
    }


def _render_template_value(value: Any, *, index: int, scenario_name: str, workflow_id: str) -> Any:
    if isinstance(value, str):
        return value.format(index=index, scenario_name=scenario_name, workflow_id=workflow_id)
    if isinstance(value, list):
        return [
            _render_template_value(item, index=index, scenario_name=scenario_name, workflow_id=workflow_id)
            for item in value
        ]
    if isinstance(value, dict):
        return {
            key: _render_template_value(item, index=index, scenario_name=scenario_name, workflow_id=workflow_id)
            for key, item in value.items()
        }
    return value


def build_create_work_item_payloads(
    action: dict[str, Any],
    *,
    workflow_id: str,
    scenario_name: str,
) -> list[dict[str, Any]]:
    count = int(action.get("count", 1))
    index_start = int(action.get("index_start", 1))
    if count <= 0:
        raise RuntimeError("create_work_items action count must be positive")

    title_template = action.get("title_template")
    if not isinstance(title_template, str) or title_template.strip() == "":
        raise RuntimeError("create_work_items action title_template is required")

    payloads: list[dict[str, Any]] = []
    for index in range(index_start, index_start + count):
        payload: dict[str, Any] = {
            "request_id": _render_template_value(
                action.get("request_id_template", f"live-test-{scenario_name}-work-item-{index}"),
                index=index,
                scenario_name=scenario_name,
                workflow_id=workflow_id,
            ),
            "title": _render_template_value(
                title_template,
                index=index,
                scenario_name=scenario_name,
                workflow_id=workflow_id,
            ),
        }
        for source_key, target_key in (
            ("parent_work_item_id", "parent_work_item_id"),
            ("branch_key_template", "branch_key"),
            ("stage_name", "stage_name"),
            ("goal_template", "goal"),
            ("acceptance_criteria_template", "acceptance_criteria"),
            ("column_id", "column_id"),
            ("owner_role", "owner_role"),
            ("priority", "priority"),
            ("notes_template", "notes"),
            ("metadata", "metadata"),
        ):
            value = action.get(source_key)
            if value is None:
                continue
            payload[target_key] = _render_template_value(
                value,
                index=index,
                scenario_name=scenario_name,
                workflow_id=workflow_id,
            )
        payloads.append(payload)
    return payloads


def workflow_action_wait_conditions_met(
    action: dict[str, Any],
    *,
    workflow: dict[str, Any],
    work_items_snapshot: Any,
    board_snapshot: Any,
) -> bool:
    wait_for = action.get("wait_for", {})
    if not isinstance(wait_for, dict) or not wait_for:
        return True

    expected_workflow_state = wait_for.get("workflow_state")
    if expected_workflow_state is not None and workflow.get("state") != expected_workflow_state:
        return False

    if "completed_work_items_min" in wait_for:
        if _completed_work_item_count(work_items_snapshot, board_snapshot) < int(wait_for["completed_work_items_min"]):
            return False

    if "total_work_items_min" in wait_for:
        if len(_work_items(work_items_snapshot)) < int(wait_for["total_work_items_min"]):
            return False

    if "open_work_items_max" in wait_for:
        if _open_work_item_count(work_items_snapshot, board_snapshot) > int(wait_for["open_work_items_max"]):
            return False

    if "all_work_items_terminal" in wait_for:
        expected = bool(wait_for["all_work_items_terminal"])
        actual = _open_work_item_count(work_items_snapshot, board_snapshot) == 0
        if actual != expected:
            return False

    return True


def dispatch_workflow_actions(
    client: ApiClient,
    *,
    workflow_id: str,
    scenario_name: str,
    actions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    executed: list[dict[str, Any]] = []
    for action in actions:
        action_type = str(action.get("type") or "").strip()
        if action_type == "":
            raise RuntimeError("scenario action type is required")
        if action_type != "create_work_items":
            raise RuntimeError(f"unsupported scenario action type: {action_type}")

        payloads = build_create_work_item_payloads(
            action,
            workflow_id=workflow_id,
            scenario_name=scenario_name,
        )
        dispatch_mode = str(action.get("dispatch", "serial")).strip()
        if dispatch_mode not in {"serial", "parallel"}:
            raise RuntimeError(f"unsupported create_work_items dispatch mode: {dispatch_mode}")

        def create_work_item(payload: dict[str, Any]) -> dict[str, Any]:
            return extract_data(
                client.request(
                    "POST",
                    f"/api/v1/workflows/{workflow_id}/work-items",
                    payload=payload,
                    expected=(201,),
                    label=f"workflows.work-items.create:{payload['request_id']}",
                )
            )

        if dispatch_mode == "parallel" and len(payloads) > 1:
            max_workers = int(action.get("max_workers", len(payloads)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                responses = list(executor.map(create_work_item, payloads))
        else:
            responses = [create_work_item(payload) for payload in payloads]

        executed.append(
            {
                "type": action_type,
                "dispatch": dispatch_mode,
                "count": len(payloads),
                "responses": responses,
            }
        )
    return executed


def dispatch_ready_workflow_actions(
    client: ApiClient,
    *,
    workflow_id: str,
    scenario_name: str,
    actions: list[dict[str, Any]],
    next_action_index: int,
    workflow: dict[str, Any],
    work_items_snapshot: Any,
    board_snapshot: Any,
) -> tuple[int, list[dict[str, Any]]]:
    executed: list[dict[str, Any]] = []
    current_index = next_action_index
    while current_index < len(actions):
        action = actions[current_index]
        if not workflow_action_wait_conditions_met(
            action,
            workflow=workflow,
            work_items_snapshot=work_items_snapshot,
            board_snapshot=board_snapshot,
        ):
            break
        executed.extend(
            dispatch_workflow_actions(
                client,
                workflow_id=workflow_id,
                scenario_name=scenario_name,
                actions=[action],
            )
        )
        current_index += 1
    return current_index, executed


def collect_workflow_events(client: ApiClient, *, workflow_id: str, per_page: int = 100) -> dict[str, Any]:
    after: str | None = None
    collected: list[dict[str, Any]] = []

    while True:
        path = f"/api/v1/workflows/{workflow_id}/events?limit={per_page}"
        if after:
            path = f"{path}&after={after}"

        snapshot = client.best_effort_request(
            "GET",
            path,
            expected=(200,),
            label="workflows.events",
        )
        if not snapshot.get("ok"):
            return snapshot

        payload = snapshot.get("data")
        data = extract_data(payload)
        page_items = data if isinstance(data, list) else []
        collected.extend(item for item in page_items if isinstance(item, dict))

        meta = payload.get("meta", {}) if isinstance(payload, dict) else {}
        has_more = bool(meta.get("has_more"))
        next_after = meta.get("next_after")
        if not has_more or not isinstance(next_after, str) or next_after.strip() == "":
            return {
                "ok": True,
                "data": {
                    "data": collected,
                    "meta": {
                        "has_more": False,
                        "next_after": None,
                    },
                },
            }
        after = next_after


def collect_workflow_stage_gates(client: ApiClient, *, workflow_id: str) -> dict[str, Any]:
    return client.best_effort_request(
        "GET",
        f"/api/v1/workflows/{workflow_id}/gates",
        expected=(200,),
        label="workflows.gates",
    )

__all__ = [name for name in globals() if not name.startswith("__")]
