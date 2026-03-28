#!/usr/bin/env python3
from __future__ import annotations

from typing import Any


def summarize_run_payload(
    run_payload: dict[str, Any],
    *,
    deliverables_packet: dict[str, Any] | None = None,
) -> dict[str, Any]:
    verification = _mapping(run_payload.get("verification"))
    evidence = _mapping(run_payload.get("evidence"))
    outcome_metrics = _mapping(run_payload.get("outcome_metrics"))
    success = _mapping(outcome_metrics.get("success"))
    hygiene = _mapping(outcome_metrics.get("hygiene"))

    deliverables = summarize_deliverables_packet(deliverables_packet)
    fatal_log_count = count_fatal_logs(_mapping(evidence.get("log_anomalies")))
    runtime_cleanup = _mapping(evidence.get("runtime_cleanup"))
    db_state = _mapping(evidence.get("db_state"))
    final_output_count = int(success.get("output_artifact_count") or 0)

    return {
        "runner_exit_code_ok": int(run_payload.get("runner_exit_code", -1)) == 0,
        "verification_passed": bool(verification.get("passed")),
        "final_output_present": final_output_count > 0 or deliverables["final_count"] > 0,
        "db_state_present": bool(db_state.get("ok")),
        "terminal_work_item_count": int(success.get("terminal_work_item_count") or 0),
        "runtime_cleanup_passed": bool(runtime_cleanup.get("all_clean"))
        or bool(hygiene.get("runtime_cleanup_passed")),
        "fatal_log_free": fatal_log_count == 0,
        "fatal_log_count": fatal_log_count,
        "deliverables": deliverables,
    }


def summarize_deliverables_packet(packet: dict[str, Any] | None) -> dict[str, Any]:
    payload = _mapping(packet)
    provenance = _mapping(payload.get("inputs_and_provenance"))
    launch_packet = _mapping(provenance.get("launch_packet"))
    redrive_packet = _mapping(provenance.get("redrive_packet"))
    return {
        "final_count": len(_list(payload.get("final_deliverables"))),
        "in_progress_count": len(_list(payload.get("in_progress_deliverables"))),
        "launch_packet_summary": _string(launch_packet.get("summary")),
        "supplemental_packet_count": len(_list(provenance.get("supplemental_packets"))),
        "intervention_attachment_count": len(_list(provenance.get("intervention_attachments"))),
        "redrive_packet_summary": _string(redrive_packet.get("summary")),
    }


def count_fatal_logs(log_anomalies: dict[str, Any]) -> int:
    count = 0
    for row in _list(log_anomalies.get("rows")):
        entry = _mapping(row)
        if _string(entry.get("level")).lower() == "fatal":
            count += 1
    return count


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None
