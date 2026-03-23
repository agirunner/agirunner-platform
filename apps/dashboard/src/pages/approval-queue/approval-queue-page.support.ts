import type { useQueryClient } from '@tanstack/react-query';
import type { useSearchParams } from 'react-router-dom';

import type { DashboardApprovalStageGateRecord } from '../../lib/api.js';
import { invalidateWorkflowQueries } from '../workflow-detail/workflow-detail-query.js';
import { readGateId } from '../work-shared/gate-detail-support.js';

export const APPROVAL_QUEUE_INITIAL_VISIBLE_COUNT = 25;
export const APPROVAL_QUEUE_VISIBLE_INCREMENT = 25;

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

export function limitApprovalQueueItems<T>(items: T[], visibleCount: number): T[] {
  return items.slice(0, Math.max(visibleCount, 0));
}

export function countHiddenApprovalQueueItems(totalCount: number, visibleCount: number): number {
  return Math.max(totalCount - visibleCount, 0);
}

export function nextApprovalQueueVisibleCount(
  currentVisibleCount: number,
  totalCount: number,
  increment = APPROVAL_QUEUE_VISIBLE_INCREMENT,
): number {
  return Math.min(totalCount, currentVisibleCount + increment);
}

export function readApprovalQueueWindowSummary(
  visibleCount: number,
  totalCount: number,
  noun: string,
): string {
  return `Showing ${Math.min(visibleCount, totalCount)} of ${totalCount} visible ${noun}.`;
}

export function readApprovalQueueTargetGateId(
  searchParams: URLSearchParams,
  hash: string,
): string | null {
  const searchGateId = searchParams.get('gate')?.trim();
  if (searchGateId) {
    return searchGateId;
  }
  if (!hash.startsWith('#gate-')) {
    return null;
  }
  return decodeGateHash(hash.slice('#gate-'.length));
}

export function findApprovalQueueGateIndex(
  gates: DashboardApprovalStageGateRecord[],
  targetGateId: string | null,
): number {
  if (!targetGateId) {
    return -1;
  }
  return gates.findIndex((gate) => readGateId(gate) === targetGateId);
}

function decodeGateHash(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}
