import unittest

from agentbaton_sdk import PlatformApiClient


class PlatformApiClientTests(unittest.TestCase):
    def test_project_and_workflow_methods_delegate_to_transport(self) -> None:
        calls: list[tuple[str, str, dict | None, bool]] = []

        def transport(path: str, method: str, body: dict | None, include_auth: bool):
            calls.append((path, method, body, include_auth))
            if path == "/api/v1/projects?per_page=50":
                return {"data": [{"id": "project-1"}]}
            if path == "/api/v1/projects/project-1":
                return {"data": {"id": "project-1", "memory": {}}}
            if path == "/api/v1/projects/project-1/memory":
                return {"data": {"id": "project-1", "memory": {"last_run_summary": {}}}}
            if path == "/api/v1/projects/project-1/timeline":
                return {"data": [{"pipeline_id": "pipe-1"}]}
            if path == "/api/v1/pipelines/pipe-1/config/resolved?show_layers=true":
                return {"data": {"pipeline_id": "pipe-1", "resolved_config": {"retries": 2}}}
            if path == "/api/v1/pipelines/pipe-1/documents":
                return {"data": [{"logical_name": "brief"}]}
            if path == "/api/v1/projects/project-1/planning-pipeline":
                return {"data": {"id": "pipe-1"}}
            if path == "/api/v1/pipelines/pipe-1/phases/review/gate":
                return {"data": {"id": "pipe-1", "current_phase": "review"}}
            if path == "/api/v1/pipelines/pipe-1/phases/review/cancel":
                return {"data": {"id": "pipe-1", "state": "cancelled"}}
            if path == "/api/v1/tasks/task-1/artifacts":
                return {"data": [{"id": "artifact-1"}]}
            raise AssertionError(f"Unexpected path {path}")

        client = PlatformApiClient("http://localhost:8080", "token", transport)

        self.assertEqual(client.list_projects({"per_page": 50})["data"][0]["id"], "project-1")
        self.assertEqual(client.get_project("project-1")["id"], "project-1")
        self.assertEqual(
            client.patch_project_memory("project-1", "last_run_summary", {})["memory"],
            {"last_run_summary": {}},
        )
        self.assertEqual(client.get_project_timeline("project-1")[0]["pipeline_id"], "pipe-1")
        self.assertEqual(
            client.get_resolved_pipeline_config("pipe-1", True)["resolved_config"],
            {"retries": 2},
        )
        self.assertEqual(client.list_pipeline_documents("pipe-1")[0]["logical_name"], "brief")
        self.assertEqual(
            client.create_planning_pipeline("project-1", "Plan next run")["id"],
            "pipe-1",
        )
        self.assertEqual(
            client.act_on_phase_gate("pipe-1", "review", {"action": "approve"})["current_phase"],
            "review",
        )
        self.assertEqual(client.cancel_phase("pipe-1", "review")["state"], "cancelled")
        self.assertEqual(client.list_task_artifacts("task-1")[0]["id"], "artifact-1")
        self.assertGreaterEqual(len(calls), 10)


if __name__ == "__main__":
    unittest.main()
