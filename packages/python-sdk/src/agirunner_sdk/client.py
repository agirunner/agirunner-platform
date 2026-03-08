from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlencode
from urllib import request
from urllib.error import HTTPError


class PlatformApiError(RuntimeError):
    def __init__(self, status: int, response_body: str) -> None:
        super().__init__(f"HTTP {status}: {response_body}")
        self.status = status
        self.response_body = response_body


Transport = Callable[[str, str, dict[str, Any] | None, bool], Any]


@dataclass
class PlatformApiClient:
    base_url: str
    access_token: str | None = None
    transport: Transport | None = None

    def set_access_token(self, token: str) -> None:
        self.access_token = token

    def exchange_api_key(self, api_key: str) -> dict[str, Any]:
        return self._request_data("/api/v1/auth/token", method="POST", body={"api_key": api_key}, include_auth=False)

    def list_tasks(self, query: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request(self._with_query("/api/v1/tasks", query))

    def get_task(self, task_id: str) -> dict[str, Any]:
        return self._request_data(f"/api/v1/tasks/{task_id}")

    def list_workflows(self, query: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request(self._with_query("/api/v1/workflows", query))

    def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        return self._request_data(f"/api/v1/workflows/{workflow_id}")

    def create_workflow(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request_data("/api/v1/workflows", method="POST", body=payload)

    def cancel_workflow(self, workflow_id: str) -> dict[str, Any]:
        return self._request_data(f"/api/v1/workflows/{workflow_id}/cancel", method="POST")

    def act_on_phase_gate(self, workflow_id: str, phase_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request_data(
            f"/api/v1/workflows/{workflow_id}/phases/{phase_name}/gate",
            method="POST",
            body=payload,
        )

    def cancel_phase(self, workflow_id: str, phase_name: str) -> dict[str, Any]:
        return self._request_data(f"/api/v1/workflows/{workflow_id}/phases/{phase_name}/cancel", method="POST")

    def get_resolved_workflow_config(self, workflow_id: str, show_layers: bool = False) -> dict[str, Any]:
        suffix = "?show_layers=true" if show_layers else ""
        return self._request_data(f"/api/v1/workflows/{workflow_id}/config/resolved{suffix}")

    def list_workflow_documents(self, workflow_id: str) -> list[dict[str, Any]]:
        return self._request_data(f"/api/v1/workflows/{workflow_id}/documents")

    def list_projects(self, query: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request(self._with_query("/api/v1/projects", query))

    def get_project(self, project_id: str) -> dict[str, Any]:
        return self._request_data(f"/api/v1/projects/{project_id}")

    def patch_project_memory(self, project_id: str, key: str, value: Any) -> dict[str, Any]:
        return self._request_data(
            f"/api/v1/projects/{project_id}/memory",
            method="PATCH",
            body={"key": key, "value": value},
        )

    def get_project_timeline(self, project_id: str) -> list[dict[str, Any]]:
        return self._request_data(f"/api/v1/projects/{project_id}/timeline")

    def create_planning_workflow(self, project_id: str, brief: str, name: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"brief": brief}
        if name:
            body["name"] = name
        return self._request_data(f"/api/v1/projects/{project_id}/planning-workflow", method="POST", body=body)

    def list_task_artifacts(self, task_id: str) -> list[dict[str, Any]]:
        return self._request_data(f"/api/v1/tasks/{task_id}/artifacts")

    def _request_data(
        self,
        path: str,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        include_auth: bool = True,
    ) -> Any:
        return self._request(path, method=method, body=body, include_auth=include_auth)["data"]

    def _request(
        self,
        path: str,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        include_auth: bool = True,
    ) -> Any:
        if self.transport is not None:
            return self.transport(path, method, body, include_auth)

        headers = {"Content-Type": "application/json"}
        if include_auth and self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        payload = None if body is None else json.dumps(body).encode("utf-8")
        req = request.Request(f"{self.base_url.rstrip('/')}{path}", data=payload, headers=headers, method=method)
        try:
            with request.urlopen(req) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise PlatformApiError(error.code, error.read().decode("utf-8")) from error

    def _with_query(self, path: str, query: dict[str, Any] | None) -> str:
        if not query:
            return path

        normalized = {key: value for key, value in query.items() if value is not None}
        if not normalized:
            return path
        return f"{path}?{urlencode(normalized)}"
