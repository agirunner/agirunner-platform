#!/usr/bin/env python3
from __future__ import annotations

from typing import Any


SKILL_SECTION_HEADER = "## Specialist Skills"
REMOTE_MCP_SECTION_HEADER = "## Remote MCP Servers Available"


def build_capability_proof(*, workflow: dict[str, Any], logs: Any) -> dict[str, Any]:
    prompt_fragments: set[str] = set()
    successful_mcp_tool_names: list[str] = []
    prompt_task_count = 0
    has_skill_prompt_section = False
    has_remote_mcp_prompt_section = False
    task_map = {
        str(task.get("id")): task
        for task in workflow.get("tasks", [])
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    for row in execution_log_rows(logs):
        task = task_map.get(str(row.get("task_id") or ""))
        if not isinstance(task, dict) or bool(task.get("is_orchestrator_task")):
            continue
        if row.get("operation") == "llm.chat_stream" and row.get("status") == "started":
            content = collect_system_prompt_content(row.get("payload"))
            if content:
                prompt_task_count += 1
                if SKILL_SECTION_HEADER in content:
                    has_skill_prompt_section = True
                if REMOTE_MCP_SECTION_HEADER in content:
                    has_remote_mcp_prompt_section = True
                prompt_fragments.update(fragment for fragment in content.split() if fragment)
        if row.get("operation") == "tool.execute" and row.get("status") == "completed":
            payload = row.get("payload")
            if not isinstance(payload, dict):
                continue
            tool_name = str(payload.get("tool_name") or "").strip()
            if tool_name.startswith("mcp_"):
                successful_mcp_tool_names.append(tool_name)
    return {
        "prompt_task_count": prompt_task_count,
        "has_skill_prompt_section": has_skill_prompt_section,
        "has_remote_mcp_prompt_section": has_remote_mcp_prompt_section,
        "prompt_fragments": sorted(prompt_fragments),
        "successful_mcp_tool_names": successful_mcp_tool_names,
        "workflow_text": collect_nested_text(workflow),
    }


def evaluate_capability_expectations(
    *,
    expectations: dict[str, Any],
    setup: dict[str, Any],
    proof: dict[str, Any],
) -> dict[str, Any]:
    failures: list[str] = []
    evaluate_skill_expectations(expectations.get("skills"), setup, proof, failures)
    evaluate_remote_mcp_expectations(expectations.get("remote_mcp"), setup, proof, failures)
    return {
        "passed": len(failures) == 0,
        "failures": failures,
    }


def evaluate_skill_expectations(
    expectations: Any,
    setup: dict[str, Any],
    proof: dict[str, Any],
    failures: list[str],
) -> None:
    if not isinstance(expectations, dict) or not expectations:
        return
    assigned_skill_slugs = assigned_role_slugs(setup, "skill_slugs")
    require_setup_slugs(expectations.get("required_skill_slugs"), assigned_skill_slugs, "skill", failures)
    require_prompt_section(expectations.get("require_prompt_section"), proof.get("has_skill_prompt_section"), "skills", failures)
    require_prompt_fragments(expectations.get("required_prompt_fragments"), proof.get("prompt_fragments"), "skills", failures)
    require_output_fragments(expectations.get("required_output_fragments"), proof.get("workflow_text"), "skills", failures)
    forbid_prompt_section(expectations.get("forbid_remote_mcp_prompt_section"), proof.get("has_remote_mcp_prompt_section"), "remote MCP", failures)


def evaluate_remote_mcp_expectations(
    expectations: Any,
    setup: dict[str, Any],
    proof: dict[str, Any],
    failures: list[str],
) -> None:
    if not isinstance(expectations, dict) or not expectations:
        return
    assigned_server_slugs = assigned_role_slugs(setup, "mcp_server_slugs")
    require_setup_slugs(expectations.get("required_server_slugs"), assigned_server_slugs, "remote MCP server", failures)
    require_prompt_section(expectations.get("require_prompt_section"), proof.get("has_remote_mcp_prompt_section"), "remote MCP", failures)
    require_prompt_fragments(expectations.get("required_prompt_fragments"), proof.get("prompt_fragments"), "remote MCP", failures)
    require_output_fragments(expectations.get("required_output_fragments"), proof.get("workflow_text"), "remote MCP", failures)
    forbid_prompt_section(expectations.get("forbid_skill_prompt_section"), proof.get("has_skill_prompt_section"), "skills", failures)
    require_mcp_tool_calls(expectations, proof, failures)


def assigned_role_slugs(setup: dict[str, Any], field_name: str) -> set[str]:
    slugs: set[str] = set()
    for role in setup.get("roles", []):
        if not isinstance(role, dict):
            continue
        values = role.get(field_name, [])
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str) and value.strip():
                slugs.add(value.strip())
    return slugs


def require_setup_slugs(required: Any, assigned: set[str], label: str, failures: list[str]) -> None:
    if not isinstance(required, list):
        return
    for value in required:
        if not isinstance(value, str) or not value.strip():
            continue
        if value.strip() not in assigned:
            failures.append(f"expected setup to assign {label} slug {value.strip()!r}")


def require_prompt_section(expected: Any, actual: Any, label: str, failures: list[str]) -> None:
    if bool(expected) and not bool(actual):
        failures.append(f"expected {label} prompt section to appear in specialist prompts")


def forbid_prompt_section(expected: Any, actual: Any, label: str, failures: list[str]) -> None:
    if bool(expected) and bool(actual):
        failures.append(f"expected {label} prompt section to be absent")


def require_prompt_fragments(required: Any, actual: Any, label: str, failures: list[str]) -> None:
    if not isinstance(required, list):
        return
    actual_text = " ".join(fragment for fragment in actual or [] if isinstance(fragment, str))
    for fragment in required:
        if isinstance(fragment, str) and fragment.strip() and fragment.strip() not in actual_text:
            failures.append(f"expected {label} prompt fragment {fragment.strip()!r}")


def require_output_fragments(required: Any, actual: Any, label: str, failures: list[str]) -> None:
    if not isinstance(required, list):
        return
    actual_text = str(actual or "")
    for fragment in required:
        if isinstance(fragment, str) and fragment.strip() and fragment.strip() not in actual_text:
            failures.append(f"expected {label} output fragment {fragment.strip()!r}")


def require_mcp_tool_calls(expectations: dict[str, Any], proof: dict[str, Any], failures: list[str]) -> None:
    successful = [name for name in proof.get("successful_mcp_tool_names", []) if isinstance(name, str)]
    if bool(expectations.get("require_successful_tool_calls")) and not successful:
        failures.append("expected at least one successful MCP tool call")
    if "minimum_successful_tool_calls" in expectations:
        minimum = int(expectations["minimum_successful_tool_calls"])
        if len(successful) < minimum:
            failures.append(f"expected at least {minimum} successful MCP tool calls, found {len(successful)}")
    required_fragments = expectations.get("required_tool_name_fragments")
    if isinstance(required_fragments, list):
        tool_text = " ".join(successful)
        for fragment in required_fragments:
            if isinstance(fragment, str) and fragment.strip() and fragment.strip() not in tool_text:
                failures.append(f"expected successful MCP tool name fragment {fragment.strip()!r}")


def collect_system_prompt_content(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    messages = payload.get("messages", [])
    if not isinstance(messages, list):
        return ""
    content: list[str] = []
    for message in messages:
        if isinstance(message, dict) and message.get("role") == "system":
            text = message.get("content")
            if isinstance(text, str) and text.strip():
                content.append(text)
    return "\n".join(content)


def execution_log_rows(logs: Any) -> list[dict[str, Any]]:
    if isinstance(logs, list):
        return [row for row in logs if isinstance(row, dict)]
    if isinstance(logs, dict):
        rows = logs.get("data", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def collect_nested_text(value: Any) -> str:
    collected: list[str] = []
    collect_nested_text_parts(value, collected)
    return " ".join(collected)


def collect_nested_text_parts(value: Any, collected: list[str]) -> None:
    if isinstance(value, str):
        text = value.strip()
        if text:
            collected.append(text)
        return
    if isinstance(value, list):
        for entry in value:
            collect_nested_text_parts(entry, collected)
        return
    if isinstance(value, dict):
        for entry in value.values():
            collect_nested_text_parts(entry, collected)
