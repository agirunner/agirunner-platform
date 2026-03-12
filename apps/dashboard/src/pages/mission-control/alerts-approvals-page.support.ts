interface TimestampedTaskLike {
  created_at?: string | null;
}

interface TimestampedGateLike {
  requested_at?: string | null;
  updated_at?: string | null;
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
