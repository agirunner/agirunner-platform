import type { useQueryClient } from '@tanstack/react-query';
import type { useSearchParams } from 'react-router-dom';

import { invalidateWorkflowQueries } from '../workflow-detail-query.js';

export function invalidateApprovalWorkflowQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workflowId?: string | null,
): Promise<void> {
  if (!workflowId) {
    return Promise.resolve();
  }
  return invalidateWorkflowQueries(queryClient, workflowId);
}

export function updateApprovalQueueSearchParams(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  updater: (params: URLSearchParams) => void,
): void {
  setSearchParams(
    (current) => {
      const next = new URLSearchParams(current);
      updater(next);
      return next;
    },
    { replace: true },
  );
}
