#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


LIVE_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIVE_LIB))

import run_workflow_scenario  # noqa: E402


class ExecutionLogSnapshotSyncTests(unittest.TestCase):
    def test_accepts_positional_client_with_keyword_only_evidence_inputs(self) -> None:
        execution_logs_snapshot = {"data": [{"id": "3509"}]}
        workspace_scope_trace = {
            "workflow_scope": {
                "workspace_api": {
                    "live_console": {
                        "execution_turn_ids": ["3509"],
                    }
                }
            }
        }
        client = object()

        with (
            patch.object(
                run_workflow_scenario,
                "collect_execution_logs",
                return_value=execution_logs_snapshot,
            ) as collect_logs,
            patch.object(
                run_workflow_scenario,
                "build_workspace_scope_trace",
                return_value=workspace_scope_trace,
            ) as build_scope_trace,
        ):
            execution_logs, reconciled_trace = (
                run_workflow_scenario.collect_consistent_workspace_scope_evidence(
                    client,
                    workflow_id="workflow-123",
                    workflow={"id": "workflow-123"},
                    db_state_snapshot={"ok": True},
                )
            )

        self.assertEqual(execution_logs_snapshot, execution_logs)
        self.assertEqual(workspace_scope_trace, reconciled_trace)
        collect_logs.assert_called_once_with(client, workflow_id="workflow-123")
        build_scope_trace.assert_called_once_with(
            client,
            workflow_id="workflow-123",
            workflow={"id": "workflow-123"},
            db_state={"ok": True},
            execution_logs=execution_logs_snapshot,
        )

    def test_collects_fresh_execution_logs_when_workspace_scope_surfaces_later_rows(self) -> None:
        initial_logs = {"data": [{"id": "3509"}]}
        refreshed_logs = {"data": [{"id": "3509"}, {"id": "7323"}]}
        stale_scope_trace = {
            "workflow_scope": {
                "workspace_api": {
                    "live_console": {
                        "execution_turn_ids": ["3509", "7323"],
                    }
                }
            }
        }
        refreshed_scope_trace = {
            "workflow_scope": {
                "workspace_api": {
                    "live_console": {
                        "execution_turn_ids": ["3509", "7323"],
                    }
                }
            }
        }

        with (
            patch.object(
                run_workflow_scenario,
                "collect_execution_logs",
                side_effect=[initial_logs, refreshed_logs],
            ) as collect_logs,
            patch.object(
                run_workflow_scenario,
                "build_workspace_scope_trace",
                side_effect=[stale_scope_trace, refreshed_scope_trace],
            ) as build_scope_trace,
        ):
            execution_logs, workspace_scope_trace = (
                run_workflow_scenario.collect_consistent_workspace_scope_evidence(
                    client=object(),
                    workflow_id="workflow-123",
                    workflow={"id": "workflow-123"},
                    db_state_snapshot={"ok": True},
                )
            )

        self.assertEqual(refreshed_logs, execution_logs)
        self.assertEqual(refreshed_scope_trace, workspace_scope_trace)
        self.assertEqual(2, collect_logs.call_count)
        self.assertEqual(2, build_scope_trace.call_count)

    def test_does_not_refresh_when_execution_logs_already_cover_workspace_scope(self) -> None:
        execution_logs_snapshot = {"data": [{"id": "3509"}, {"id": "7323"}]}
        workspace_scope_trace = {
            "workflow_scope": {
                "workspace_api": {
                    "live_console": {
                        "execution_turn_ids": ["3509", "7323"],
                    }
                }
            }
        }

        with (
            patch.object(
                run_workflow_scenario,
                "collect_execution_logs",
                return_value=execution_logs_snapshot,
            ) as collect_logs,
            patch.object(
                run_workflow_scenario,
                "build_workspace_scope_trace",
                return_value=workspace_scope_trace,
            ) as build_scope_trace,
        ):
            execution_logs, reconciled_trace = (
                run_workflow_scenario.collect_consistent_workspace_scope_evidence(
                    client=object(),
                    workflow_id="workflow-123",
                    workflow={"id": "workflow-123"},
                    db_state_snapshot={"ok": True},
                )
            )

        self.assertEqual(execution_logs_snapshot, execution_logs)
        self.assertEqual(workspace_scope_trace, reconciled_trace)
        self.assertEqual(1, collect_logs.call_count)
        self.assertEqual(1, build_scope_trace.call_count)


if __name__ == "__main__":
    unittest.main()
