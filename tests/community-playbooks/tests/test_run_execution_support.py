#!/usr/bin/env python3
from __future__ import annotations


class FakeRunApi:
    def __init__(self) -> None:
        self.workflow_reads = 0
        self.created_workspace_payloads: list[dict[str, object]] = []
        self.created_workflow_payloads: list[dict[str, object]] = []
        self.approval_calls: list[dict[str, str]] = []
        self.default_execution_environment_calls: list[str] = []
        self.call_order: list[str] = []

    def list_execution_environments(self) -> list[dict[str, object]]:
        return [
            {"id": "env-debian", "catalog_key": "debian-base", "slug": "debian-base"},
            {"id": "env-node", "catalog_key": "node-base", "slug": "node-base"},
        ]

    def set_default_execution_environment(self, environment_id: str) -> None:
        self.call_order.append(f"set_default:{environment_id}")
        self.default_execution_environment_calls.append(environment_id)

    def create_workspace(self, payload: dict[str, object]) -> dict[str, str]:
        self.call_order.append("create_workspace")
        self.created_workspace_payloads.append(payload)
        return {"id": "ws-1", "slug": str(payload["slug"])}

    def create_workflow(self, payload: dict[str, object]) -> dict[str, str]:
        self.call_order.append("create_workflow")
        self.created_workflow_payloads.append(payload)
        return {"id": "wf-1", "state": "planned", "workspace_id": "ws-1"}

    def get_workflow(self, workflow_id: str) -> dict[str, str]:
        self.workflow_reads += 1
        if self.workflow_reads == 1:
            return {"id": workflow_id, "state": "in_progress"}
        return {"id": workflow_id, "state": "completed"}

    def list_work_items(self, workflow_id: str) -> list[dict[str, str]]:
        return [{"id": "wi-1", "title": "Draft recommendation", "state": "in_progress"}]

    def list_operator_briefs(
        self,
        workflow_id: str,
        *,
        work_item_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, str]]:
        return [{"id": "brief-1", "work_item_id": "wi-1"}]

    def list_approvals(self) -> dict[str, list[dict[str, str]]]:
        if self.workflow_reads == 0:
            return {"stage_gates": []}
        return {
            "stage_gates": [
                {
                    "gate_id": "gate-1",
                    "workflow_id": "wf-1",
                    "status": "awaiting_approval",
                }
            ]
        }

    def list_logs(self, *, workflow_id: str, status: str = "failed", per_page: int = 20) -> list[dict[str, object]]:
        return []

    def read_api_path(self, path: str) -> object:
        if path == "/preview/final":
            return "# Final Research Synthesis\n\n## Findings\nA grounded answer.\n\n## Confidence\nMedium."
        raise AssertionError(f"unexpected API path {path}")

    def submit_approval(
        self,
        gate_id: str,
        *,
        request_id: str,
        action: str,
        feedback: str,
    ) -> dict[str, str]:
        payload = {
            "gate_id": gate_id,
            "request_id": request_id,
            "action": action,
            "feedback": feedback,
        }
        self.approval_calls.append(payload)
        return payload

    def submit_steering_request(
        self,
        workflow_id: str,
        *,
        request_id: str,
        request_text: str,
        work_item_id: str | None = None,
        task_id: str | None = None,
        linked_input_packet_ids: list[str] | None = None,
        session_id: str | None = None,
        base_snapshot_version: str | None = None,
    ) -> dict[str, str | None]:
        return {
            "workflow_id": workflow_id,
            "request_id": request_id,
            "request_text": request_text,
            "work_item_id": work_item_id,
        }

    def get_workspace_packet(
        self,
        workflow_id: str,
        *,
        work_item_id: str | None = None,
        live_console_limit: int = 100,
        deliverables_limit: int = 100,
        briefs_limit: int = 100,
        history_limit: int = 100,
    ) -> dict[str, object]:
        return {
            "live_console": {"total_count": 3},
            "deliverables": {
                "final_deliverables": [{"descriptor_kind": "brief_packet"}],
                "in_progress_deliverables": [],
            },
        }
