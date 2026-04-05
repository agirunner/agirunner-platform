import type { QueryClient } from '@tanstack/react-query';

import type { DashboardWorkflowOperationsStreamBatch } from '../../lib/api.js';

export function invalidateWorkflowRealtimeProjectionQueries(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  input: {
    workflowId: string | null;
    selectedWorkItemId: string | null;
    batch: DashboardWorkflowOperationsStreamBatch;
  },
): void {
  const touchedWorkItemIds = readTouchedWorkItemIds(input.batch);
  const hasBoardRefresh = batchHasWorkspaceBoardRefresh(input.batch);
  const shouldRefreshWorkspace = hasBoardRefresh || touchedWorkItemIds.size > 0;

  if (shouldRefreshWorkspace) {
    invalidateWorkflowWorkspaceQuery(queryClient, input.workflowId);
  }

  if (hasBoardRefresh) {
    invalidateWorkflowWorkItemQueries(queryClient, input.workflowId);
    return;
  }

  for (const workItemId of touchedWorkItemIds) {
    invalidateSpecificWorkItemQueries(queryClient, input.workflowId, workItemId);
  }

  if (
    input.selectedWorkItemId
    && !touchedWorkItemIds.has(input.selectedWorkItemId)
    && batchTouchesSelectedWorkItem(input.batch, input.selectedWorkItemId)
  ) {
    invalidateSpecificWorkItemQueries(queryClient, input.workflowId, input.selectedWorkItemId);
  }
}

export function invalidateWorkflowRealtimeQueriesOnReconnect(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  workflowId: string | null,
): void {
  invalidateWorkflowWorkspaceQuery(queryClient, workflowId);
  invalidateWorkflowWorkItemQueries(queryClient, workflowId);
}

function invalidateWorkflowWorkspaceQuery(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  workflowId: string | null,
): void {
  if (!workflowId) {
    return;
  }
  void queryClient.invalidateQueries({
    queryKey: ['workflows', 'workspace', workflowId],
  });
}

function invalidateWorkflowWorkItemQueries(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  workflowId: string | null,
): void {
  if (!workflowId) {
    return;
  }
  void queryClient.invalidateQueries({
    queryKey: ['workflows', 'work-item-detail', workflowId],
  });
  void queryClient.invalidateQueries({
    queryKey: ['workflows', 'work-item-tasks', workflowId],
  });
}

function invalidateSpecificWorkItemQueries(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  workflowId: string | null,
  workItemId: string | null,
): void {
  if (!workflowId || !workItemId) {
    return;
  }
  void queryClient.invalidateQueries({
    queryKey: ['workflows', 'work-item-detail', workflowId, workItemId],
  });
  void queryClient.invalidateQueries({
    queryKey: ['workflows', 'work-item-tasks', workflowId, workItemId],
  });
}

function batchHasWorkspaceBoardRefresh(batch: DashboardWorkflowOperationsStreamBatch): boolean {
  return batch.events.some((event) => event.event_type === 'workspace_board_update');
}

function batchTouchesSelectedWorkItem(
  batch: DashboardWorkflowOperationsStreamBatch,
  selectedWorkItemId: string,
): boolean {
  return batch.events.some((event) => eventTouchesWorkItem(event, selectedWorkItemId));
}

function readTouchedWorkItemIds(batch: DashboardWorkflowOperationsStreamBatch): Set<string> {
  const touchedWorkItemIds = new Set<string>();

  for (const event of batch.events) {
    if (event.event_type === 'workspace_board_update') {
      continue;
    }
    if (event.event_type === 'deliverable_upsert') {
      const workItemId = readOptionalText(readRecord(event.payload)?.work_item_id);
      if (workItemId) {
        touchedWorkItemIds.add(workItemId);
      }
      continue;
    }
    if (
      event.event_type === 'live_console_append'
      || event.event_type === 'briefs_append'
      || event.event_type === 'history_append'
    ) {
      for (const item of readArray(readRecord(event.payload)?.items)) {
        const workItemId = readOptionalText(readRecord(item)?.work_item_id);
        if (workItemId) {
          touchedWorkItemIds.add(workItemId);
        }
      }
    }
  }

  return touchedWorkItemIds;
}

function eventTouchesWorkItem(
  event: DashboardWorkflowOperationsStreamBatch['events'][number],
  workItemId: string,
): boolean {
  if (event.event_type === 'deliverable_upsert') {
    return readOptionalText(readRecord(event.payload)?.work_item_id) === workItemId;
  }
  if (
    event.event_type === 'live_console_append'
    || event.event_type === 'briefs_append'
    || event.event_type === 'history_append'
  ) {
    return readArray(readRecord(event.payload)?.items).some((item) => {
      return readOptionalText(readRecord(item)?.work_item_id) === workItemId;
    });
  }
  return false;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
