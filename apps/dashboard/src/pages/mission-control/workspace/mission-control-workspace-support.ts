import type {
  DashboardMissionControlPacket,
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
} from '../../../lib/api.js';
import type { BadgeProps } from '../../../components/ui/badge.js';
import type { WorkflowHistoryTone } from '../../workflow-detail/workflow-history-card.js';

export function coerceMissionControlBoard(
  value: Record<string, unknown> | null,
): DashboardWorkflowBoardResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<DashboardWorkflowBoardResponse>;
  if (!Array.isArray(candidate.columns) || !Array.isArray(candidate.work_items)) {
    return null;
  }

  return candidate as DashboardWorkflowBoardResponse;
}

export function describeMissionControlPosture(
  posture: DashboardMissionControlWorkflowCard['posture'],
): { label: string; variant: BadgeProps['variant'] } {
  switch (posture) {
    case 'needs_decision':
      return { label: 'Needs Decision', variant: 'warning' };
    case 'needs_intervention':
      return { label: 'Needs Intervention', variant: 'destructive' };
    case 'recoverable_needs_steering':
      return { label: 'Needs Steering', variant: 'warning' };
    case 'waiting_by_design':
      return { label: 'Waiting By Design', variant: 'outline' };
    case 'paused':
      return { label: 'Paused', variant: 'secondary' };
    case 'terminal_failed':
      return { label: 'Terminal Failed', variant: 'destructive' };
    case 'completed':
      return { label: 'Completed', variant: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'secondary' };
    case 'progressing':
    default:
      return { label: 'Progressing', variant: 'info' };
  }
}

export function describeMissionControlPacketCategory(
  category: DashboardMissionControlPacket['category'],
): { label: string; tone: WorkflowHistoryTone; badgeVariant: BadgeProps['variant'] } {
  switch (category) {
    case 'decision':
      return { label: 'Decision', tone: 'warning', badgeVariant: 'warning' };
    case 'intervention':
      return { label: 'Intervention', tone: 'warning', badgeVariant: 'warning' };
    case 'output':
      return { label: 'Output', tone: 'default', badgeVariant: 'info' };
    case 'system':
      return { label: 'System', tone: 'default', badgeVariant: 'secondary' };
    case 'progress':
    default:
      return { label: 'Progress', tone: 'default', badgeVariant: 'outline' };
  }
}

export function readMissionControlRelationCount(summary: Record<string, unknown>): number {
  const childStatusCounts = asRecord(summary.child_status_counts);
  const childCount = readNumber(childStatusCounts.total);
  if (childCount !== null) {
    return childCount;
  }

  const children = summary.children;
  if (Array.isArray(children)) {
    return children.length;
  }

  const childWorkflowIds = summary.child_workflow_ids;
  if (Array.isArray(childWorkflowIds)) {
    return childWorkflowIds.length;
  }

  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
