import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardMissionControlWorkflowCard,
  type DashboardWorkflowRailPacket,
  type DashboardWorkflowRailRow,
} from '../../lib/api.js';
import {
  buildWorkflowsPageHref,
  resolveSelectedWorkflowId,
  type WorkflowsPageState,
} from './workflows-page.support.js';
import { readStoredWorkflowId, writeStoredWorkflowId } from './workflows-page.storage.js';

type WorkflowLifecycleAction = 'pause' | 'resume' | 'cancel';

export function useWorkflowRailSelectionSync(input: {
  navigate: NavigateFunction;
  pageState: WorkflowsPageState;
  railPacket: DashboardWorkflowRailPacket | null;
  selectedWorkflowRow: DashboardWorkflowRailRow | null;
  workflowDetailError: boolean;
  workspaceError: boolean;
}): void {
  useEffect(() => {
    if (!input.railPacket || input.pageState.workflowId) {
      return;
    }
    const selectableRows = [...input.railPacket.rows, ...input.railPacket.ongoing_rows];
    if (selectableRows.length === 0) {
      return;
    }
    const nextWorkflowId = resolveSelectedWorkflowId({
      currentWorkflowId: input.pageState.workflowId,
      rows: selectableRows,
      selectedWorkflowId: input.railPacket.selected_workflow_id,
      storedWorkflowId: readStoredWorkflowId(),
    });
    if (!nextWorkflowId) {
      return;
    }
    patchPageState(input.navigate, input.pageState, {
      workflowId: nextWorkflowId,
    });
  }, [input.navigate, input.pageState, input.railPacket]);

  useEffect(() => {
    if (!input.railPacket || !input.pageState.workflowId) {
      return;
    }
    const selectableRows = [...input.railPacket.rows, ...input.railPacket.ongoing_rows];
    if (selectableRows.some((row) => row.workflow_id === input.pageState.workflowId)) {
      return;
    }
    if (!input.selectedWorkflowRow && (input.workspaceError || input.workflowDetailError)) {
      const nextWorkflowId = resolveSelectedWorkflowId({
        currentWorkflowId: null,
        rows: selectableRows,
        selectedWorkflowId: input.railPacket.selected_workflow_id,
        storedWorkflowId: readStoredWorkflowId(),
      });
      patchPageState(input.navigate, input.pageState, {
        workflowId: nextWorkflowId,
        workItemId: null,
        tab: null,
      });
    }
  }, [
    input.navigate,
    input.pageState,
    input.railPacket,
    input.selectedWorkflowRow,
    input.workflowDetailError,
    input.workspaceError,
  ]);

  useEffect(() => {
    if (!input.pageState.workflowId) {
      return;
    }
    writeStoredWorkflowId(input.pageState.workflowId);
  }, [input.pageState.workflowId]);
}

export async function handleWorkflowWorkItemLifecycleAction(input: {
  action: WorkflowLifecycleAction;
  navigate: NavigateFunction;
  pageState: WorkflowsPageState;
  queryClient: QueryClient;
  workItemId: string;
}): Promise<void> {
  patchPageState(input.navigate, input.pageState, { workItemId: input.workItemId });
  if (!input.pageState.workflowId) {
    return;
  }
  if (input.action === 'pause') {
    await dashboardApi.pauseWorkflowWorkItem(input.pageState.workflowId, input.workItemId);
  } else if (input.action === 'resume') {
    await dashboardApi.resumeWorkflowWorkItem(input.pageState.workflowId, input.workItemId);
  } else {
    await dashboardApi.cancelWorkflowWorkItem(input.pageState.workflowId, input.workItemId);
  }
  await input.queryClient.invalidateQueries({ queryKey: ['workflows'] });
}

export function deriveSelectedWorkflowRow(
  rows: DashboardWorkflowRailRow[],
  ongoingRows: DashboardWorkflowRailRow[],
  workflowId: string | null,
  workflow: DashboardMissionControlWorkflowCard | null,
): DashboardWorkflowRailRow | null {
  if (!workflowId) {
    return null;
  }
  const visibleRow = [...rows, ...ongoingRows].find((row) => row.workflow_id === workflowId);
  if (visibleRow) {
    return visibleRow;
  }
  if (!workflow) {
    return null;
  }
  return {
    workflow_id: workflow.id,
    name: workflow.name,
    state: workflow.state ?? null,
    lifecycle: workflow.lifecycle ?? null,
    current_stage: workflow.currentStage ?? null,
    workspace_name: workflow.workspaceName ?? null,
    playbook_name: workflow.playbookName ?? null,
    posture: workflow.posture ?? null,
    live_summary: workflow.pulse.summary,
    last_changed_at: workflow.metrics.lastChangedAt ?? workflow.pulse.updatedAt ?? null,
    needs_action:
      workflow.attentionLane === 'needs_decision'
      || workflow.attentionLane === 'needs_intervention'
      || workflow.posture === 'needs_decision'
      || workflow.posture === 'needs_intervention'
      || workflow.posture === 'recoverable_needs_steering'
      || workflow.posture === 'terminal_failed',
    counts: {
      active_task_count: workflow.metrics.activeTaskCount,
      active_work_item_count: workflow.metrics.activeWorkItemCount,
      blocked_work_item_count: workflow.metrics.blockedWorkItemCount,
      open_escalation_count: workflow.metrics.openEscalationCount,
      waiting_for_decision_count: workflow.metrics.waitingForDecisionCount,
      failed_task_count: workflow.metrics.failedTaskCount,
    },
  };
}

export function patchPageState(
  navigate: NavigateFunction,
  currentState: WorkflowsPageState,
  patch: Partial<WorkflowsPageState>,
): void {
  const currentHref = buildWorkflowsPageHref({}, currentState);
  const nextHref = buildWorkflowsPageHref(patch, currentState);
  if (nextHref === currentHref) {
    return;
  }
  navigate(nextHref, {
    replace: true,
  });
}
