#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import validate_live_result
import workflow_scope_trace


class LiveResultCompletenessSupport:
    def build_complete_evidence(
        self,
        evidence_dir: Path,
        *,
        workspace_scope_trace: dict[str, object] | None = None,
    ) -> dict[str, object]:
        evidence: dict[str, object] = {}
        artifacts: dict[str, str] = {}
        for key in validate_live_result.REQUIRED_SETTLED_EVIDENCE_KEYS:
            if key == "workspace_scope_trace":
                payload = workspace_scope_trace or self.build_workspace_scope_trace()
            else:
                payload = {"ok": True, "key": key}
            artifact_path = evidence_dir / f"{key}.json"
            artifact_path.write_text(json.dumps(payload), encoding="utf-8")
            evidence[key] = payload
            artifacts[key] = str(artifact_path)
        evidence["artifacts"] = artifacts
        return evidence

    def build_workspace_scope_trace(self) -> dict[str, object]:
        return {
            "ok": True,
            "failures": [],
            "selected_work_item_id": "wi-1",
            "workflow_scope": self.build_scope_entry(
                scope_kind="workflow",
                work_item_id=None,
                task_id=None,
            ),
            "selected_work_item_scope": self.build_scope_entry(
                scope_kind="selected_work_item",
                work_item_id="wi-1",
                task_id=None,
            ),
        }

    def build_scope_entry(
        self,
        *,
        scope_kind: str,
        work_item_id: str | None,
        task_id: str | None,
    ) -> dict[str, object]:
        live_console_ids = {
            "brief_ids": ["brief-1"],
            "execution_turn_ids": ["111"],
            "execution_turn_items": [
                {
                    "log_id": "111",
                    "item_id": "execution-log:111",
                    "headline": "[Think] Inspect the seeded workflow state before routing work.",
                    "summary": "Inspect the seeded workflow state before routing work.",
                    "task_id": task_id,
                    "work_item_id": work_item_id,
                }
            ],
        }
        deliverable_ids = {
            "all_descriptor_ids": ["descriptor-1", "brief-1", "handoff-1"],
            "final_descriptor_ids": ["descriptor-1"],
            "in_progress_descriptor_ids": [],
            "brief_packet_ids": ["brief-1"],
            "handoff_packet_ids": ["handoff-1"],
            "working_handoff_brief_ids": ["brief-1"],
        }
        return {
            "scope_kind": scope_kind,
            "selection": {
                "work_item_id": work_item_id,
                "task_id": task_id,
            },
            "workspace_api": {
                "selected_scope": {
                    "scope_kind": scope_kind,
                    "work_item_id": work_item_id,
                    "task_id": task_id,
                },
                "live_console": {
                    "item_kind_counts": {
                        "milestone_brief": 1,
                        "execution_turn": 1,
                    },
                    "tracked_item_kind_counts": {
                        "milestone_brief": 1,
                    },
                    **live_console_ids,
                },
                "deliverables": {
                    "descriptor_kind_counts": {
                        "report": 1,
                        "brief_packet": 1,
                        "handoff_packet": 1,
                    },
                    **deliverable_ids,
                },
            },
            "db": {
                **live_console_ids,
                **deliverable_ids,
                "all_descriptor_ids": ["descriptor-1", "brief-1", "handoff-1"],
                "record_item_kind_counts": {
                    "milestone_brief": 1,
                },
                "deliverable_descriptor_kind_counts": {
                    "report": 1,
                    "brief_packet": 1,
                    "handoff_packet": 1,
                },
            },
            "enhanced_live_console": {
                "applicable": True,
                "effective_mode": "enhanced",
                "expected_rows": [
                    {
                        "log_id": "111",
                        "operation": "agent.think",
                        "phase": "think",
                        "phase_label": "Think",
                        "surface_expected": True,
                        "surface_kind": "execution_turn",
                        "expected_headline": "[Think] Inspect the seeded workflow state before routing work.",
                        "expected_summary": "Inspect the seeded workflow state before routing work.",
                        "task_id": task_id,
                        "work_item_id": work_item_id,
                    },
                    {
                        "log_id": "112",
                        "operation": "agent.act",
                        "phase": "act",
                        "phase_label": "Act",
                        "surface_expected": False,
                        "surface_kind": "execution_turn",
                        "expected_headline": None,
                        "expected_summary": None,
                        "suppression_reason": "low_value_read_only_tool",
                        "task_id": task_id,
                        "work_item_id": work_item_id,
                    },
                ],
                "actual_rows": [
                    live_console_ids["execution_turn_items"][0]
                ],
                "passed": True,
                "failures": [],
            },
            "reconciliation": {
                "passed": True,
                "failures": [],
            },
        }

