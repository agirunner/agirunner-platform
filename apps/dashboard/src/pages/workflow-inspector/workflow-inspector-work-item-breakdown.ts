import type { DashboardWorkflowRecord } from '../../lib/api.js';
import { formatCost } from '../../components/execution-inspector/execution-inspector-support.js';
import { readWorkflowRunSummary } from '../workflow-detail/workflow-detail-support.js';

export function buildWorkItemBreakdownEntries(
  workflowId: string,
  workflow?: DashboardWorkflowRecord,
): Array<{
  label: string;
  value: string;
  detail: string;
  href: string;
}> {
  const analytics = asRecord(asRecord(readWorkflowRunSummary(workflow)).orchestrator_analytics);
  const workItems = Array.isArray(workflow?.work_items) ? workflow.work_items : [];
  const workItemIndex = new Map(workItems.map((item) => [item.id, item]));

  return asArray(analytics.cost_by_work_item)
    .map((entry) => {
      const workItemId = readString(asRecord(entry).work_item_id) ?? 'unassigned';
      const workItem = workItemIndex.get(workItemId);
      const taskCount = Number(asRecord(entry).task_count ?? 0);
      const title = workItem?.title?.trim() || `Work item ${workItemId.slice(0, 8)}`;
      const stageName = workItem?.stage_name?.trim();
      return {
        label: title,
        value: formatCost(Number(asRecord(entry).total_cost_usd ?? 0)),
        detail: stageName
          ? `${stageName} • ${taskCount} step${taskCount === 1 ? '' : 's'} contributed to this work item.`
          : `${taskCount} step${taskCount === 1 ? '' : 's'} contributed to this work item.`,
        href: `/work/boards/${workflowId}/inspector?view=detailed&work_item=${workItemId}`,
      };
    })
    .filter((entry) => entry.value !== '$0.00')
    .slice(0, 3);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
