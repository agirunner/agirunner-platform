#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys


SUITE_ROOT = Path(__file__).resolve().parents[1]
LIB_ROOT = SUITE_ROOT / "lib"
if str(LIB_ROOT) not in sys.path:
    sys.path.insert(0, str(LIB_ROOT))

from import_catalog import assign_specialist_model_to_roles, run_import_only


class StubRoleApi:
    def __init__(self) -> None:
        self.assignment_calls: list[tuple[str, str, str]] = []

    def list_roles(self) -> list[dict[str, str]]:
        return [
            {"id": "role-1", "name": "research-assistant"},
            {"id": "role-2", "name": "writer"},
        ]

    def upsert_role_assignment(
        self,
        role_name: str,
        *,
        primary_model_id: str | None,
        reasoning_effort: str | None,
    ) -> dict[str, str | None]:
        self.assignment_calls.append((role_name, primary_model_id or "", reasoning_effort or ""))
        return {
            "role_name": role_name,
            "primary_model_id": primary_model_id,
            "reasoning_effort": reasoning_effort,
        }


class StubImportApi(StubRoleApi):
    def __init__(self) -> None:
        super().__init__()
        self.catalog_calls: list[str] = []

    def list_catalog_playbooks(self) -> list[dict[str, str]]:
        self.catalog_calls.append("list")
        return [{"id": "research-analysis", "slug": "research-analysis"}]

    def preview_import(self, playbook_ids: list[str]) -> dict[str, int]:
        self.catalog_calls.append(f"preview:{','.join(playbook_ids)}")
        return {"selectionCount": len(playbook_ids)}

    def import_playbooks(self, playbook_ids: list[str], *, default_conflict_resolution: str = "override_existing") -> dict[str, object]:
        self.catalog_calls.append(f"import:{','.join(playbook_ids)}")
        return {
            "importBatchId": "batch-1",
            "importedPlaybooks": [
                {
                    "catalogId": "research-analysis",
                    "localEntityId": "pb-1",
                    "localSlug": "research-analysis",
                }
            ],
        }


class ImportRunnerTests(unittest.TestCase):
    def test_assign_specialist_model_to_roles_updates_all_roles(self) -> None:
        api = StubRoleApi()

        assignments = assign_specialist_model_to_roles(
            api,
            specialist_model_id="model-specialist",
            reasoning_effort="medium",
        )

        self.assertEqual(
            [
                ("research-assistant", "model-specialist", "medium"),
                ("writer", "model-specialist", "medium"),
            ],
            api.assignment_calls,
        )
        self.assertEqual(2, len(assignments))

    def test_run_import_only_writes_import_summary(self) -> None:
        api = StubImportApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "import-summary.json"

            payload = run_import_only(
                prepare_environment_fn=lambda: {
                    "specialist_model_id": "model-specialist",
                    "specialist_reasoning": "medium",
                },
                api_factory=lambda trace_dir: api,
                output_path=output_path,
            )

            self.assertTrue(output_path.is_file())
            self.assertEqual(1, payload["catalog_playbook_count"])
            self.assertEqual(2, len(payload["role_assignments"]))
            self.assertEqual(["list", "preview:research-analysis", "import:research-analysis"], api.catalog_calls)
            self.assertEqual(
                [("research-assistant", "model-specialist", "medium"), ("writer", "model-specialist", "medium")],
                api.assignment_calls,
            )


if __name__ == "__main__":
    unittest.main()
