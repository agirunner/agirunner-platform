#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import specialist_capability_proof  # noqa: E402


class SpecialistCapabilityProofTests(unittest.TestCase):
    def test_build_capability_proof_captures_skill_prompt_and_mcp_tool_calls(self) -> None:
        workflow = {
            "tasks": [
                {"id": "task-1", "role": "researcher", "is_orchestrator_task": False},
                {"id": "task-2", "role": "orchestrator", "is_orchestrator_task": True},
            ],
            "output": {"summary": "SKILL_EVIDENCE final answer"},
        }
        logs = {
            "data": [
                {
                    "operation": "llm.chat_stream",
                    "status": "started",
                    "task_id": "task-1",
                    "payload": {
                        "messages": [
                            {
                                "role": "system",
                                "content": "## Specialist Skills\n### Structured Summary\nSKILL_EVIDENCE\n## Remote MCP Servers Available\n- Fixture Search: Search the fixture docs. Tools: search",
                            }
                        ]
                    },
                },
                {
                    "operation": "tool.execute",
                    "status": "completed",
                    "task_id": "task-1",
                    "payload": {"tool_name": "mcp_fixture_search"},
                },
            ]
        }

        proof = specialist_capability_proof.build_capability_proof(workflow=workflow, logs=logs)

        self.assertEqual(1, proof["prompt_task_count"])
        self.assertTrue(proof["has_skill_prompt_section"])
        self.assertTrue(proof["has_remote_mcp_prompt_section"])
        self.assertEqual(["mcp_fixture_search"], proof["successful_mcp_tool_names"])
        self.assertIn("SKILL_EVIDENCE", proof["prompt_fragments"])
        self.assertIn("SKILL_EVIDENCE", proof["workflow_text"])

    def test_evaluate_capability_expectations_checks_skills_and_mcp_separately(self) -> None:
        proof = {
            "prompt_task_count": 1,
            "has_skill_prompt_section": True,
            "has_remote_mcp_prompt_section": True,
            "prompt_fragments": ["SKILL_EVIDENCE", "Fixture Search", "search"],
            "successful_mcp_tool_names": ["mcp_fixture_search"],
            "workflow_text": "SKILL_EVIDENCE final answer",
        }
        setup = {
            "roles": [
                {
                    "name": "researcher",
                    "skill_slugs": ["structured-summary"],
                    "mcp_server_slugs": ["fixture-search"],
                }
            ]
        }
        expectations = {
            "skills": {
                "required_skill_slugs": ["structured-summary"],
                "require_prompt_section": True,
                "required_prompt_fragments": ["SKILL_EVIDENCE"],
                "required_output_fragments": ["SKILL_EVIDENCE final answer"],
            },
            "remote_mcp": {
                "required_server_slugs": ["fixture-search"],
                "require_prompt_section": True,
                "require_successful_tool_calls": True,
                "required_tool_name_fragments": ["fixture", "search"],
            },
        }

        result = specialist_capability_proof.evaluate_capability_expectations(
            expectations=expectations,
            setup=setup,
            proof=proof,
        )

        self.assertTrue(result["passed"])
        self.assertEqual([], result["failures"])

    def test_build_capability_proof_reads_live_system_prompt_fields(self) -> None:
        workflow = {
            "tasks": [
                {"id": "task-1", "role": "researcher", "is_orchestrator_task": False},
            ],
            "output": {"summary": "SKILL-SENTINEL final answer"},
        }
        logs = {
            "data": [
                {
                    "operation": "llm.chat_stream",
                    "status": "started",
                    "task_id": "task-1",
                    "payload": {
                        "system_prompt": (
                            "## Specialist Skills\n"
                            "### Skill Sentinel\n"
                            "SKILL-SENTINEL: basalt-lantern-20260326\n"
                        ),
                        "system_prompts": [
                            "## Specialist Skills\n### Skill Sentinel\nSKILL-SENTINEL: basalt-lantern-20260326\n",
                        ],
                    },
                },
            ]
        }

        proof = specialist_capability_proof.build_capability_proof(workflow=workflow, logs=logs)

        self.assertEqual(1, proof["prompt_task_count"])
        self.assertTrue(proof["has_skill_prompt_section"])
        self.assertIn("SKILL-SENTINEL:", proof["prompt_fragments"])
        self.assertIn("basalt-lantern-20260326", proof["prompt_fragments"])
        self.assertIn("SKILL-SENTINEL: basalt-lantern-20260326", proof["prompt_text"])

    def test_evaluate_capability_expectations_matches_contiguous_prompt_fragments(self) -> None:
        result = specialist_capability_proof.evaluate_capability_expectations(
            expectations={
                "skills": {
                    "required_prompt_fragments": ["SKILL-SENTINEL: basalt-lantern-20260326"],
                }
            },
            setup={"roles": []},
            proof={
                "prompt_task_count": 1,
                "has_skill_prompt_section": True,
                "has_remote_mcp_prompt_section": False,
                "prompt_fragments": ["SKILL-SENTINEL:", "basalt-lantern-20260326"],
                "prompt_text": "## Specialist Skills\nSKILL-SENTINEL: basalt-lantern-20260326\n",
                "successful_mcp_tool_names": [],
                "workflow_text": "",
            },
        )

        self.assertTrue(result["passed"])
        self.assertEqual([], result["failures"])


if __name__ == "__main__":
    unittest.main()
