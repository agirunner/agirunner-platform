export interface WorkflowListRecord {
  id: string;
  name: string;
  project_name?: string;
  project_id?: string;
  playbook_id?: string | null;
  status: string;
  state?: string;
  current_stage?: string | null;
  active_stages?: string[];
  lifecycle?: 'standard' | 'continuous' | null;
  task_counts?: Record<string, number>;
  cost?: number;
  created_at: string;
  work_item_summary?: {
    total_work_items: number;
    open_work_item_count: number;
    completed_work_item_count: number;
    active_stage_count: number;
    awaiting_gate_count: number;
    active_stage_names: string[];
  } | null;
}

function readLiveStageNames(workflow: WorkflowListRecord): string[] {
  const summaryStages =
    workflow.work_item_summary?.active_stage_names.filter(
      (stage): stage is string => typeof stage === 'string' && stage.trim().length > 0,
    ) ?? [];
  const activeStages = workflow.active_stages?.filter((stage): stage is string => stage.trim().length > 0) ?? [];
  return Array.from(new Set([...summaryStages, ...activeStages]));
}

export type StatusFilter = 'all' | 'planned' | 'active' | 'gated' | 'blocked' | 'done';
export type TypeFilter = 'all' | 'standard' | 'continuous';
export type ViewMode = 'list' | 'board';

export const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'planned',
  'active',
  'gated',
  'blocked',
  'done',
];
export const TYPE_FILTERS: TypeFilter[] = ['all', 'standard', 'continuous'];
export const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  all: 'All Types',
  standard: 'Standard',
  continuous: 'Continuous',
};
export const BOARD_COLUMNS = ['planned', 'active', 'gated', 'blocked', 'done'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export function normalizeWorkflows(response: unknown): WorkflowListRecord[] {
  if (Array.isArray(response)) {
    return response as WorkflowListRecord[];
  }
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as WorkflowListRecord[]) : [];
}

export function resolveStatus(workflow: WorkflowListRecord): string {
  const rawState = (workflow.status ?? workflow.state ?? '').toLowerCase();
  const summary = workflow.work_item_summary;
  if (summary?.awaiting_gate_count) {
    return 'gated';
  }
  if ((summary?.open_work_item_count ?? 0) > 0 || readLiveStageNames(workflow).length > 0) {
    return 'active';
  }
  if (rawState === 'failed' || rawState === 'error' || rawState === 'cancelled') {
    return 'blocked';
  }
  if (summary && summary.total_work_items > 0 && summary.open_work_item_count === 0) {
    return 'done';
  }
  if (rawState === 'completed') {
    return 'done';
  }
  if (rawState === 'paused') {
    return 'blocked';
  }
  return 'planned';
}

export function statusBadgeVariant(status: string) {
  const map: Record<string, 'success' | 'default' | 'destructive' | 'warning' | 'secondary'> = {
    planned: 'secondary',
    active: 'default',
    gated: 'warning',
    blocked: 'destructive',
    done: 'success',
  };
  return map[status] ?? 'secondary';
}

export function formatTaskProgress(counts?: Record<string, number>): string {
  if (!counts) {
    return '-';
  }
  const completed = counts.completed ?? 0;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return `${completed}/${total}`;
}

export function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) {
    return '-';
  }
  return `$${cost.toFixed(2)}`;
}

export function describeWorkflowCost(workflow: WorkflowListRecord): string {
  if (workflow.cost === undefined || workflow.cost === null) {
    return 'No spend reported';
  }
  return `${formatCost(workflow.cost)} reported`;
}

export function describeWorkflowProgress(workflow: WorkflowListRecord): string {
  const summary = workflow.work_item_summary;
  if (!summary) {
    return 'No work items queued';
  }
  if (summary.total_work_items === 0) {
    return 'No work items queued';
  }
  return `${summary.completed_work_item_count} of ${summary.total_work_items} work items complete`;
}

export function describeWorkflowType(workflow: WorkflowListRecord): string {
  return workflow.lifecycle === 'continuous' ? 'Continuous board run' : 'Milestone board run';
}

export function describeWorkflowStage(workflow: WorkflowListRecord): string {
  const liveStages = readLiveStageNames(workflow);
  if (workflow.lifecycle === 'continuous') {
    return liveStages.length > 0 ? liveStages.join(', ') : '-';
  }
  if (workflow.current_stage) {
    return workflow.current_stage;
  }
  if (liveStages.length > 0) {
    return liveStages.join(', ');
  }
  return '-';
}

export function describeOperatorSignal(workflow: WorkflowListRecord): string {
  const summary = workflow.work_item_summary;
  const liveStages = readLiveStageNames(workflow);
  const status = resolveStatus(workflow);

  if (status === 'gated') {
    const count = summary?.awaiting_gate_count ?? 0;
    return `${count} gate${count === 1 ? '' : 's'} waiting`;
  }
  if (status === 'active') {
    const openCount = summary?.open_work_item_count ?? 0;
    const liveStageLabel =
      liveStages.length > 0
        ? ` across ${liveStages.length} live stage${liveStages.length === 1 ? '' : 's'}`
        : '';
    return `${openCount} open work item${openCount === 1 ? '' : 's'}${liveStageLabel}`;
  }
  if (status === 'done') {
    if (summary && summary.total_work_items > 0) {
      return `${summary.completed_work_item_count} completed work item${summary.completed_work_item_count === 1 ? '' : 's'}`;
    }
    return 'Board run complete';
  }
  if (status === 'blocked') {
    const rawState = (workflow.status ?? workflow.state ?? '').toLowerCase();
    if (rawState === 'paused') {
      return 'Stage or gate work paused';
    }
    if (rawState === 'cancelled') {
      return 'Board run cancelled';
    }
    if (rawState === 'failed' || rawState === 'error') {
      return 'Board run blocked by failure';
    }
    return 'Operator attention needed';
  }
  return 'No work items queued';
}

export function describeWorkItemSummary(workflow: WorkflowListRecord): string {
  const summary = workflow.work_item_summary;
  if (!summary) {
    return 'No work items';
  }
  const activeStages =
    summary.active_stage_names.length > 0 ? `, ${summary.active_stage_names.length} live stage${summary.active_stage_names.length === 1 ? '' : 's'}` : '';
  return `${summary.open_work_item_count} open / ${summary.total_work_items} total${activeStages}`;
}

export function describeGateSummary(workflow: WorkflowListRecord): string {
  const awaitingGateCount = workflow.work_item_summary?.awaiting_gate_count ?? 0;
  return awaitingGateCount > 0 ? `${awaitingGateCount} gate${awaitingGateCount === 1 ? '' : 's'} waiting` : 'No gates waiting';
}

export function resolveTypeFilter(workflow: WorkflowListRecord): Exclude<TypeFilter, 'all'> {
  return workflow.lifecycle === 'continuous' ? 'continuous' : 'standard';
}

export function formatRelativeRunAge(createdAt: string, now = Date.now()): string {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) {
    return 'Unknown age';
  }
  const deltaMinutes = Math.max(0, Math.floor((now - created) / 60_000));
  if (deltaMinutes < 1) {
    return 'Started just now';
  }
  if (deltaMinutes < 60) {
    return `Started ${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `Started ${deltaHours}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `Started ${deltaDays}d ago`;
}

export function summarizeWorkflowCollection(workflows: WorkflowListRecord[]) {
  return workflows.reduce(
    (summary, workflow) => {
      const status = resolveStatus(workflow);
      if (status === 'active') {
        summary.active += 1;
      } else if (status === 'gated') {
        summary.gated += 1;
      } else if (status === 'blocked') {
        summary.blocked += 1;
      } else if (status === 'done') {
        summary.done += 1;
      }
      summary.openWorkItems += workflow.work_item_summary?.open_work_item_count ?? 0;
      summary.completedWorkItems += workflow.work_item_summary?.completed_work_item_count ?? 0;
      summary.awaitingGates += workflow.work_item_summary?.awaiting_gate_count ?? 0;
      if (typeof workflow.cost === 'number') {
        summary.reportedSpend += workflow.cost;
        summary.spentBoards += 1;
      }
      return summary;
    },
    {
      total: workflows.length,
      active: 0,
      gated: 0,
      blocked: 0,
      done: 0,
      openWorkItems: 0,
      completedWorkItems: 0,
      awaitingGates: 0,
      reportedSpend: 0,
      spentBoards: 0,
    },
  );
}

export function describeCollectionProgress(summary: ReturnType<typeof summarizeWorkflowCollection>): string {
  if (summary.openWorkItems === 0 && summary.completedWorkItems === 0) {
    return 'No work items in scope';
  }
  return `${summary.openWorkItems} open • ${summary.completedWorkItems} complete`;
}

export function describeCollectionAttention(summary: ReturnType<typeof summarizeWorkflowCollection>): string {
  const attentionBoards = summary.gated + summary.blocked;
  if (attentionBoards === 0) {
    return 'No boards need intervention';
  }
  const parts: string[] = [];
  if (summary.gated > 0) {
    parts.push(`${summary.gated} gated`);
  }
  if (summary.blocked > 0) {
    parts.push(`${summary.blocked} blocked`);
  }
  return parts.join(' • ');
}

export function describeCollectionSpend(summary: ReturnType<typeof summarizeWorkflowCollection>): string {
  if (summary.spentBoards === 0) {
    return 'No boards reporting spend';
  }
  return `${summary.spentBoards} of ${summary.total} boards reporting spend`;
}
