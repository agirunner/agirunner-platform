#!/usr/bin/env python3
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from community_catalog_api import CommunityCatalogApi, extract_data


class CommunityRunApi(CommunityCatalogApi):
    def get_local_playbook_by_slug(self, slug: str) -> dict[str, Any]:
        normalized_slug = slug.strip()
        if normalized_slug == "":
            raise RuntimeError("playbook slug is required")
        for playbook in self.list_local_playbooks():
            if str(playbook.get("slug") or "").strip() == normalized_slug:
                return dict(playbook)
        raise RuntimeError(f"imported playbook {normalized_slug!r} was not found locally")

    def create_workspace(self, payload: dict[str, Any]) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "POST",
                    "/api/v1/workspaces",
                    payload=payload,
                    expected=(201,),
                    label=f"workspaces.create:{payload.get('slug') or payload.get('name') or 'workspace'}",
                )
            )
        )

    def create_workflow(self, payload: dict[str, Any]) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "POST",
                    "/api/v1/workflows",
                    payload=payload,
                    expected=(201,),
                    label=f"workflows.create:{payload.get('name') or payload.get('playbook_id') or 'workflow'}",
                )
            )
        )

    def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "GET",
                    f"/api/v1/workflows/{workflow_id}",
                    expected=(200,),
                    label=f"workflows.get:{workflow_id}",
                )
            )
        )

    def list_work_items(self, workflow_id: str) -> list[dict[str, Any]]:
        return list(
            extract_data(
                self.client.request(
                    "GET",
                    f"/api/v1/workflows/{workflow_id}/work-items",
                    expected=(200,),
                    label=f"workflows.work-items:{workflow_id}",
                )
            )
        )

    def list_approvals(self) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "GET",
                    "/api/v1/approvals",
                    expected=(200,),
                    label="approvals.list",
                )
            )
        )

    def submit_approval(
        self,
        gate_id: str,
        *,
        request_id: str,
        action: str,
        feedback: str,
    ) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "POST",
                    f"/api/v1/approvals/{gate_id}",
                    payload={
                        "request_id": request_id,
                        "action": action,
                        "feedback": feedback,
                    },
                    expected=(200,),
                    label=f"approvals.{action}:{gate_id}",
                )
            )
        )

    def list_operator_briefs(
        self,
        workflow_id: str,
        *,
        work_item_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        query: dict[str, str] = {"limit": str(limit)}
        if work_item_id:
            query["work_item_id"] = work_item_id
        return list(
            extract_data(
                self.client.request(
                    "GET",
                    f"/api/v1/workflows/{workflow_id}/operator-briefs?{urlencode(query)}",
                    expected=(200,),
                    label=f"workflows.operator-briefs:{workflow_id}",
                )
            )
        )

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
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "request_id": request_id,
            "request": request_text,
            "linked_input_packet_ids": list(linked_input_packet_ids or []),
        }
        if work_item_id:
            payload["work_item_id"] = work_item_id
        if task_id:
            payload["task_id"] = task_id
        if session_id:
            payload["session_id"] = session_id
        if base_snapshot_version:
            payload["base_snapshot_version"] = base_snapshot_version
        return dict(
            extract_data(
                self.client.request(
                    "POST",
                    f"/api/v1/workflows/{workflow_id}/steering-requests",
                    payload=payload,
                    expected=(201,),
                    label=f"workflows.steering:{workflow_id}",
                )
            )
        )

    def get_workspace_packet(
        self,
        workflow_id: str,
        *,
        work_item_id: str | None = None,
        live_console_limit: int = 100,
        deliverables_limit: int = 100,
        briefs_limit: int = 100,
        history_limit: int = 100,
    ) -> dict[str, Any]:
        query = {
            "tab_scope": "selected_work_item" if work_item_id else "workflow",
            "live_console_limit": str(live_console_limit),
            "deliverables_limit": str(deliverables_limit),
            "briefs_limit": str(briefs_limit),
            "history_limit": str(history_limit),
        }
        if work_item_id:
            query["work_item_id"] = work_item_id
        return dict(
            extract_data(
                self.client.request(
                    "GET",
                    f"/api/v1/operations/workflows/{workflow_id}/workspace?{urlencode(query)}",
                    expected=(200,),
                    label=f"operations.workflows.workspace:{workflow_id}",
                )
            )
        )
