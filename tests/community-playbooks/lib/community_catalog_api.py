#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

from common import ApiClient


def extract_data(response: Any) -> Any:
    if isinstance(response, dict) and "data" in response:
        return response["data"]
    return response


class CommunityCatalogApi:
    def __init__(self, client: ApiClient) -> None:
        self.client = client

    def login(self, admin_api_key: str) -> ApiClient:
        response = extract_data(
            self.client.request(
                "POST",
                "/api/v1/auth/login",
                payload={"api_key": admin_api_key},
                expected=(200,),
                label="auth.login",
            )
        )
        token = str(response.get("token") or "").strip()
        if not token:
            raise RuntimeError("admin login did not return an access token")
        return self.client.with_bearer_token(
            token,
            lambda: str(
                extract_data(
                    self.client.request(
                        "POST",
                        "/api/v1/auth/login",
                        payload={"api_key": admin_api_key},
                        expected=(200,),
                        label="auth.login.refresh",
                    )
                ).get("token")
                or ""
            ).strip(),
        )

    def upsert_role_assignment(
        self,
        role_name: str,
        *,
        primary_model_id: str | None,
        reasoning_effort: str | None,
    ) -> dict[str, Any]:
        reasoning_config = None
        if reasoning_effort is not None:
            reasoning_config = {
                "effort": reasoning_effort,
                "reasoning_effort": reasoning_effort,
            }
        return dict(
            extract_data(
                self.client.request(
                    "PUT",
                    f"/api/v1/config/llm/assignments/{role_name}",
                    payload={
                        "primaryModelId": primary_model_id,
                        "reasoningConfig": reasoning_config,
                    },
                    expected=(200,),
                    label=f"llm.assignments.update:{role_name}",
                )
            )
        )

    def list_catalog_playbooks(self) -> list[dict[str, Any]]:
        return list(
            extract_data(
                self.client.request(
                    "GET",
                    "/api/v1/community-catalog/playbooks",
                    expected=(200,),
                    label="community-catalog.playbooks.list",
                )
            )
        )

    def get_catalog_playbook_detail(self, playbook_id: str) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "GET",
                    f"/api/v1/community-catalog/playbooks/{playbook_id}",
                    expected=(200,),
                    label=f"community-catalog.playbooks.detail:{playbook_id}",
                )
            )
        )

    def preview_import(self, playbook_ids: list[str]) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "POST",
                    "/api/v1/community-catalog/import-preview",
                    payload={"playbook_ids": playbook_ids},
                    expected=(200,),
                    label="community-catalog.import-preview",
                )
            )
        )

    def import_playbooks(
        self,
        playbook_ids: list[str],
        *,
        default_conflict_resolution: str = "override_existing",
    ) -> dict[str, Any]:
        return dict(
            extract_data(
                self.client.request(
                    "POST",
                    "/api/v1/community-catalog/import",
                    payload={
                        "playbook_ids": playbook_ids,
                        "default_conflict_resolution": default_conflict_resolution,
                    },
                    expected=(201,),
                    label="community-catalog.import",
                )
            )
        )

    def list_local_playbooks(self) -> list[dict[str, Any]]:
        response = self.client.request("GET", "/api/v1/playbooks", expected=(200,), label="playbooks.list")
        return list(extract_data(response))

    def delete_playbook_permanently(self, playbook_id: str) -> None:
        self.client.request(
            "DELETE",
            f"/api/v1/playbooks/{playbook_id}/permanent",
            expected=(200, 204),
            label=f"playbooks.delete-permanent:{playbook_id}",
        )

    def list_roles(self) -> list[dict[str, Any]]:
        return list(
            extract_data(
                self.client.request("GET", "/api/v1/config/roles", expected=(200,), label="roles.list")
            )
        )

    def delete_role(self, role_id: str) -> None:
        self.client.request(
            "DELETE",
            f"/api/v1/config/roles/{role_id}",
            expected=(200, 204),
            label=f"roles.delete:{role_id}",
        )

    def list_skills(self) -> list[dict[str, Any]]:
        return list(
            extract_data(
                self.client.request("GET", "/api/v1/specialist-skills", expected=(200,), label="skills.list")
            )
        )

    def delete_skill(self, skill_id: str) -> None:
        self.client.request(
            "DELETE",
            f"/api/v1/specialist-skills/{skill_id}",
            expected=(200, 204),
            label=f"skills.delete:{skill_id}",
        )

    def list_remote_mcp_servers(self) -> list[dict[str, Any]]:
        return list(
            extract_data(
                self.client.request(
                    "GET",
                    "/api/v1/remote-mcp-servers",
                    expected=(200,),
                    label="remote-mcp-servers.list",
                )
            )
        )

    def delete_remote_mcp_server(self, server_id: str) -> None:
        self.client.request(
            "DELETE",
            f"/api/v1/remote-mcp-servers/{server_id}",
            expected=(200, 204),
            label=f"remote-mcp-servers.delete:{server_id}",
        )

    def list_remote_mcp_oauth_profiles(self) -> list[dict[str, Any]]:
        return list(
            extract_data(
                self.client.request(
                    "GET",
                    "/api/v1/remote-mcp-oauth-client-profiles",
                    expected=(200,),
                    label="remote-mcp-oauth-client-profiles.list",
                )
            )
        )

    def delete_remote_mcp_oauth_profile(self, profile_id: str) -> None:
        self.client.request(
            "DELETE",
            f"/api/v1/remote-mcp-oauth-client-profiles/{profile_id}",
            expected=(200, 204),
            label=f"remote-mcp-oauth-client-profiles.delete:{profile_id}",
        )
