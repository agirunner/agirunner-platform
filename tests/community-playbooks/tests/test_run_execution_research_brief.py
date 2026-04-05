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

from run_execution import execute_run
from test_run_execution_support import FakeRunApi


def build_research_playbook() -> dict[str, object]:
    return {
        "id": "pb-1",
        "slug": "research-analysis",
        "name": "Research Analysis",
        "definition": {"parameters": []},
    }


def build_research_run_spec() -> dict[str, object]:
    return {
        "id": "research-analysis-native-search",
        "batch": "matrix",
        "playbook_slug": "research-analysis",
        "variant": "native-search",
        "workspace_profile_record": {"storage_type": "workspace_artifacts"},
        "launch_inputs": {"research_question": "What is a quantum computer?"},
        "uploads": [],
        "operator_actions": [],
        "steering_script": [],
        "expected_outcome": {
            "kind": "research_brief",
            "require_native_web_search": True,
            "require_source_basis": True,
        },
    }


def build_grounded_research_preview(path: str) -> str:
    if path != "/preview/final":
        return ""
    return (
        "# Final Synthesis: What is a quantum computer?\n\n"
        "## question_answered\nWhat is a quantum computer?\n\n"
        "## sources_consulted\n- NIST\n- IBM\n\n"
        "## source_quality_notes\nNeutral public-interest sources carried more weight than vendor explainers.\n\n"
        "## findings\nA bounded answer.\n\n"
        "## confidence\nMedium-high.\n\n"
        "## recommendation_or_next_step\nUse the source review for follow-up detail."
    )


def build_final_artifact_packet() -> dict[str, object]:
    return {
        "live_console": {"total_count": 3},
        "deliverables": {
            "final_deliverables": [
                {
                    "descriptor_kind": "artifact",
                    "title": "Quantum Computer Final Synthesis",
                    "primary_target": {"url": "/preview/final"},
                }
            ],
            "in_progress_deliverables": [],
        },
    }


class ResearchBriefRunExecutionTests(unittest.TestCase):
    def test_execute_run_research_brief_native_search_requires_grounded_final_output(self) -> None:
        api = FakeRunApi()
        api.get_workflow = lambda _: {"id": "wf-1", "state": "completed"}  # type: ignore[method-assign]
        api.list_approvals = lambda: {"stage_gates": []}  # type: ignore[method-assign]
        api.get_workspace_packet = lambda _workflow_id, **_kwargs: build_final_artifact_packet()  # type: ignore[method-assign]

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_run(
                api,
                build_research_playbook(),
                build_research_run_spec(),
                results_dir=Path(tmpdir),
                timeout_seconds=2,
                poll_interval_seconds=0,
            )

        self.assertFalse(result["passed"])
        self.assertIn("final research deliverable does not expose a visible source basis", result["failures"])
        self.assertIn("run required actual provider-managed native web search usage but no web_search evidence was recorded", result["failures"])

    def test_execute_run_research_brief_rejects_packet_only_final_rows(self) -> None:
        api = FakeRunApi()
        api.get_workflow = lambda _: {"id": "wf-1", "state": "completed"}  # type: ignore[method-assign]
        api.list_approvals = lambda: {"stage_gates": []}  # type: ignore[method-assign]
        api.get_workspace_packet = lambda _workflow_id, **_kwargs: {  # type: ignore[method-assign]
            "live_console": {"total_count": 3},
            "deliverables": {
                "final_deliverables": [
                    {
                        "descriptor_kind": "deliverable_packet",
                        "title": "Final Research Synthesis Packet",
                        "primary_target": {"url": "/preview/final"},
                    }
                ],
                "in_progress_deliverables": [],
            },
        }
        api.read_api_path = build_grounded_research_preview  # type: ignore[method-assign]
        api.list_logs = lambda **_kwargs: [  # type: ignore[method-assign]
            {"payload": {"provider_tool_calls": [{"name": "web_search", "status": "completed"}]}}
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_run(
                api,
                build_research_playbook(),
                build_research_run_spec(),
                results_dir=Path(tmpdir),
                timeout_seconds=2,
                poll_interval_seconds=0,
            )

        self.assertFalse(result["passed"])
        self.assertIn("final research deliverables only exposed packet rows instead of a real content row", result["failures"])

    def test_execute_run_research_brief_requires_actual_provider_web_search_calls(self) -> None:
        api = FakeRunApi()
        api.get_workflow = lambda _: {"id": "wf-1", "state": "completed"}  # type: ignore[method-assign]
        api.list_approvals = lambda: {"stage_gates": []}  # type: ignore[method-assign]
        api.get_workspace_packet = lambda _workflow_id, **_kwargs: build_final_artifact_packet()  # type: ignore[method-assign]
        api.read_api_path = build_grounded_research_preview  # type: ignore[method-assign]
        api.list_logs = lambda **_kwargs: [  # type: ignore[method-assign]
            {"payload": {"llm_native_search_mode": "openai_web_search"}},
            {"payload": {"tool_names": ["web_fetch", "tool_search"]}},
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_run(
                api,
                build_research_playbook(),
                build_research_run_spec(),
                results_dir=Path(tmpdir),
                timeout_seconds=2,
                poll_interval_seconds=0,
            )

        self.assertFalse(result["passed"])
        self.assertIn(
            "run required actual provider-managed native web search usage but no web_search evidence was recorded",
            result["failures"],
        )

    def test_execute_run_research_brief_native_search_passes_with_grounded_final_output(self) -> None:
        api = FakeRunApi()
        api.get_workflow = lambda _: {"id": "wf-1", "state": "completed"}  # type: ignore[method-assign]
        api.list_approvals = lambda: {"stage_gates": []}  # type: ignore[method-assign]
        api.get_workspace_packet = lambda _workflow_id, **_kwargs: {  # type: ignore[method-assign]
            "live_console": {"total_count": 3},
            "deliverables": {
                "final_deliverables": [
                    {
                        "descriptor_kind": "artifact",
                        "title": "Quantum Computer Final Synthesis",
                        "filename": "quantum-computer-final-synthesis.md",
                        "delivery_stage": "final",
                        "state": "final",
                        "specialist_label": "Research Analyst",
                        "primary_target": {"url": "/preview/final"},
                    }
                ],
                "in_progress_deliverables": [],
            },
        }
        api.read_api_path = build_grounded_research_preview  # type: ignore[method-assign]
        api.list_logs = lambda **_kwargs: [  # type: ignore[method-assign]
            {"payload": {"provider_tool_calls": [{"name": "web_search", "status": "completed"}]}}
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            result = execute_run(
                api,
                build_research_playbook(),
                build_research_run_spec(),
                results_dir=Path(tmpdir),
                timeout_seconds=2,
                poll_interval_seconds=0,
            )

        self.assertTrue(result["passed"])
        self.assertTrue(result["observed"]["final_deliverable_present"])
        self.assertEqual("Quantum Computer Final Synthesis", result["observed"]["final_deliverable_title"])
        self.assertEqual(
            "quantum-computer-final-synthesis.md",
            result["observed"]["final_deliverable_filename"],
        )
        self.assertTrue(result["observed"]["native_web_search_used"])
        self.assertTrue(result["observed"]["structured_final_research_present"])
        self.assertTrue(result["observed"]["source_basis_present"])
        self.assertTrue(result["observed"]["source_quality_notes_present"])
        self.assertIn(
            "question_answered",
            result["observed"]["final_deliverable_preview_excerpt"],
        )


if __name__ == "__main__":
    unittest.main()
