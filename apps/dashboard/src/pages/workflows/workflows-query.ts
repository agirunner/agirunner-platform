import type { QueryClient } from '@tanstack/react-query';

import { invalidateWorkflowQueries } from '../workflow-detail/workflow-detail-query.js';
import type { WorkflowPageMode } from './workflows-page.support.js';

export function buildWorkflowRailQueryKey(input: {
  mode: WorkflowPageMode;
  search: string;
  needsActionOnly: boolean;
  ongoingOnly: boolean;
}) {
  return [
    'workflows',
    'rail',
    input.mode,
    input.search,
    input.needsActionOnly,
    input.ongoingOnly,
  ] as const;
}

export function buildWorkflowWorkspaceQueryKey(input: {
  workflowId: string;
  workItemId: string | null;
  boardMode: string;
  activityLimit: number;
  deliverablesLimit: number;
}) {
  return [
    'workflows',
    'workspace',
    input.workflowId,
    input.workItemId ?? 'workflow',
    input.boardMode,
    input.activityLimit,
    input.deliverablesLimit,
  ] as const;
}

export async function invalidateWorkflowsQueries(
  queryClient: QueryClient,
  workflowId?: string | null,
  workspaceId?: string | null,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    workflowId
      ? queryClient.invalidateQueries({
          queryKey: ['workflows', 'workspace', workflowId],
        })
      : Promise.resolve(),
    workflowId
      ? invalidateWorkflowQueries(queryClient, workflowId, workspaceId ?? undefined)
      : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: ['playbooks'] }),
    queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  ]);
}
