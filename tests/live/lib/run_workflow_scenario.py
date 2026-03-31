#!/usr/bin/env python3
from __future__ import annotations

from run_workflow_scenario_chunk13 import *
import run_workflow_scenario_chunk05 as _run_workflow_scenario_chunk05


def collect_consistent_workspace_scope_evidence(*args, **kwargs):
    original_collect_execution_logs = _run_workflow_scenario_chunk05.collect_execution_logs
    original_build_workspace_scope_trace = _run_workflow_scenario_chunk05.build_workspace_scope_trace
    try:
        _run_workflow_scenario_chunk05.collect_execution_logs = collect_execution_logs
        _run_workflow_scenario_chunk05.build_workspace_scope_trace = build_workspace_scope_trace
        return _run_workflow_scenario_chunk05.collect_consistent_workspace_scope_evidence(*args, **kwargs)
    finally:
        _run_workflow_scenario_chunk05.collect_execution_logs = original_collect_execution_logs
        _run_workflow_scenario_chunk05.build_workspace_scope_trace = original_build_workspace_scope_trace


if __name__ == "__main__":
    main()
