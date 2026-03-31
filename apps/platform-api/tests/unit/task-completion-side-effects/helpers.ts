import { vi } from 'vitest';

export function createIdentity() {
  return {
    id: 'agent-key',
    tenantId: 'tenant-1',
    scope: 'agent',
    ownerType: 'agent',
    ownerId: 'agent-1',
    keyPrefix: 'agent-key',
  };
}

export function createEventService() {
  return {
    emit: vi.fn(async () => undefined),
  };
}

export function createClient(
  queryImpl: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }> | { rows: Record<string, unknown>[]; rowCount: number },
) {
  return {
    query: vi.fn(queryImpl),
  };
}

export function createCompletionTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-review',
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-1',
    role: 'reviewer',
    stage_name: 'implementation',
    is_orchestrator_task: false,
    output: { summary: 'done' },
    metadata: {},
    ...overrides,
  };
}

export function createAssessmentTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-review',
    workflow_id: 'workflow-1',
    work_item_id: 'review-item',
    role: 'reviewer',
    stage_name: 'review',
    is_orchestrator_task: false,
    rework_count: 0,
    updated_at: 'updated',
    input: {
      subject_task_id: 'task-dev',
      subject_work_item_id: 'implementation-item',
      subject_revision: 1,
    },
    metadata: {
      task_kind: 'assessment',
      subject_task_id: 'task-dev',
      subject_work_item_id: 'implementation-item',
      subject_revision: 1,
    },
    output: { verdict: 'approved' },
    ...overrides,
  };
}

export function createContinuityService() {
  return {
    recordTaskCompleted: vi.fn(async () => ({
      matchedRuleType: 'assessment',
      nextExpectedActor: 'qa',
      nextExpectedAction: 'handoff',
      requiresHumanApproval: false,
      reworkDelta: 0,
      satisfiedAssessmentExpectation: false,
    })),
    recordAssessmentRequestedChanges: vi.fn(async () => ({
      matchedRuleType: 'assessment',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      requiresHumanApproval: false,
      reworkDelta: 1,
      satisfiedAssessmentExpectation: false,
    })),
  };
}
