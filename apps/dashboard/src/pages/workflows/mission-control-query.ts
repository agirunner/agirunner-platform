import type { QueryClient } from '@tanstack/react-query';

import { invalidateWorkflowQueries } from '../workflow-detail/workflow-detail-query.js';
import { buildMissionControlWorkspaceQueryKey } from './mission-control-realtime.js';

export async function invalidateMissionControlQueries(
  queryClient: QueryClient,
  workflowId?: string | null,
  workspaceId?: string | null,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['mission-control'] }),
    workflowId
      ? queryClient.invalidateQueries({ queryKey: buildMissionControlWorkspaceQueryKey(workflowId) })
      : Promise.resolve(),
    workflowId
      ? invalidateWorkflowQueries(queryClient, workflowId, workspaceId ?? undefined)
      : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    queryClient.invalidateQueries({ queryKey: ['playbooks'] }),
    queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
    queryClient.invalidateQueries({ queryKey: ['approval-queue'] }),
    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  ]);
}
