import { buildWorkflowDetailPermalink } from '../workflow-detail/workflow-detail-permalinks.js';

interface TimestampedTaskLike {
  created_at?: string | null;
}

interface TimestampedGateLike {
  requested_at?: string | null;
  updated_at?: string | null;
}

export interface QueueTaskContextLike {
  id: string;
  workflow_id?: string | null;
  work_item_id?: string | null;
  activation_id?: string | null;
  stage_name?: string | null;
  depends_on?: string[];
  assigned_worker_id?: string | null;
  assigned_worker?: string | null;
}

export interface TaskContextFact {
  label: string;
  value: string;
}

export interface TaskContextLink {
  label: string;
  to: string;
  priority: 'primary' | 'secondary';
}

export interface TaskContextPacket {
  facts: TaskContextFact[];
  links: TaskContextLink[];
}

export interface ApprovalQueueSummary {
  total: number;
  stageGates: number;
  approvals: number;
  outputGates: number;
  escalations: number;
  failures: number;
  primaryLane: string;
  oldestAgeLabel: string;
}

function readTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatRelativeAge(ageMs: number | null): string {
  if (ageMs === null || ageMs < 0) {
    return 'No queued work';
  }
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return 'Queued just now';
  }
  if (minutes < 60) {
    return `Oldest waiting ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Oldest waiting ${hours}h`;
  }
  return `Oldest waiting ${Math.floor(hours / 24)}d`;
}

function resolvePrimaryLane(summary: Omit<ApprovalQueueSummary, 'primaryLane' | 'oldestAgeLabel'>): string {
  if (summary.stageGates > 0) {
    return 'Stage gates first';
  }
  if (summary.approvals > 0) {
    return 'Specialist step approvals next';
  }
  if (summary.outputGates > 0) {
    return 'Output gates next';
  }
  if (summary.escalations > 0) {
    return 'Operator guidance needed';
  }
  if (summary.failures > 0) {
    return 'Execution failures need action';
  }
  return 'Queue clear';
}

export function buildApprovalQueueSummary(input: {
  stageGates: TimestampedGateLike[];
  approvals: TimestampedTaskLike[];
  outputGates: TimestampedTaskLike[];
  escalations: TimestampedTaskLike[];
  failures: TimestampedTaskLike[];
  nowMs?: number;
}): ApprovalQueueSummary {
  const summaryBase = {
    stageGates: input.stageGates.length,
    approvals: input.approvals.length,
    outputGates: input.outputGates.length,
    escalations: input.escalations.length,
    failures: input.failures.length,
    total:
      input.stageGates.length +
      input.approvals.length +
      input.outputGates.length +
      input.escalations.length +
      input.failures.length,
  };
  const oldestTimestamp = Math.min(
    ...[
      ...input.stageGates.map((gate) => readTimestamp(gate.requested_at ?? gate.updated_at)),
      ...input.approvals.map((task) => readTimestamp(task.created_at)),
      ...input.outputGates.map((task) => readTimestamp(task.created_at)),
      ...input.escalations.map((task) => readTimestamp(task.created_at)),
      ...input.failures.map((task) => readTimestamp(task.created_at)),
    ].filter((value): value is number => value !== null),
  );
  const oldestAgeMs =
    Number.isFinite(oldestTimestamp) && oldestTimestamp > 0
      ? (input.nowMs ?? Date.now()) - oldestTimestamp
      : null;

  return {
    ...summaryBase,
    primaryLane: resolvePrimaryLane(summaryBase),
    oldestAgeLabel: formatRelativeAge(oldestAgeMs),
  };
}

export function buildTaskContextPacket(task: QueueTaskContextLike): TaskContextPacket {
  const facts: TaskContextFact[] = [];
  const links: TaskContextLink[] = [];

  if (task.stage_name) {
    facts.push({ label: 'Stage', value: task.stage_name });
  }
  if (task.work_item_id) {
    facts.push({ label: 'Work item', value: task.work_item_id.slice(0, 8) });
  }
  if ((task.depends_on ?? []).length > 0) {
    facts.push({ label: 'Upstream steps', value: String(task.depends_on?.length ?? 0) });
  }

  const assignedWorker = task.assigned_worker_id ?? task.assigned_worker;
  if (assignedWorker) {
    facts.push({ label: 'Assigned worker', value: assignedWorker.slice(0, 8) });
  }

  if (task.workflow_id && task.work_item_id) {
    links.push({
      label: 'Open work item flow',
      to: buildWorkflowDetailPermalink(task.workflow_id, {
        workItemId: task.work_item_id,
        activationId: task.activation_id ?? null,
      }),
      priority: 'primary',
    });
  }

  if (task.workflow_id) {
    links.push({
      label: 'Open board context',
      to: `/work/boards/${task.workflow_id}`,
      priority: task.work_item_id ? 'secondary' : 'primary',
    });
  }

  links.push({
    label: task.workflow_id && task.work_item_id ? 'Open step diagnostics' : 'Open step detail',
    to: `/work/tasks/${task.id}`,
    priority: 'secondary',
  });

  return { facts, links };
}
