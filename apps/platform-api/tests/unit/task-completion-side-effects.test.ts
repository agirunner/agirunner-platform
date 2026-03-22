import { describe, expect, it, vi } from 'vitest';

import { applyTaskCompletionSideEffects } from '../../src/services/task-completion-side-effects.js';

describe('applyTaskCompletionSideEffects', () => {
  it('auto-completes the subject task when an assessment expectation is satisfied', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_assessment'")) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              role: 'developer',
              state: 'output_pending_assessment',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                assessment_action: 'approved',
                assessment_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'reviewer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        input: {
          subject_task_id: 'task-dev',
          subject_work_item_id: 'work-item-1',
          subject_revision: 1,
        },
        metadata: {
          task_kind: 'assessment',
          subject_task_id: 'task-dev',
          subject_work_item_id: 'work-item-1',
          subject_revision: 1,
        },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(workItemContinuityService.recordTaskCompleted).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-review',
        work_item_id: 'work-item-1',
        role: 'reviewer',
      }),
      client,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-dev',
        actorId: 'assessment_resolver',
        data: expect.objectContaining({
          from_state: 'output_pending_assessment',
          to_state: 'completed',
          reason: 'assessment_approved',
          assessment_task_id: 'task-review',
        }),
      }),
      client,
    );
  });

  it('records assessment rejection continuity for a full assessor handoff that requests changes', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'full',
              resolution: 'request_changes',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'assessment',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: true,
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

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'request_changes' },
      },
      client as never,
    );

    expect(workItemContinuityService.recordTaskCompleted).not.toHaveBeenCalled();
    expect(workItemContinuityService.recordAssessmentRequestedChanges).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'task-review',
        work_item_id: 'review-item',
        role: 'reviewer',
      }),
      client,
    );
    expect(
      client.query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO workflow_activations')),
    ).toBe(false);
  });

  it('requests rework on the explicit subject task when an assessment handoff requests changes', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'full',
              resolution: 'request_changes',
              summary: 'Add malformed-input regression coverage before approval.',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('state = ANY($4::task_state[])') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', ['output_pending_assessment', 'completed'], 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_assessment',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'live-test-developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedAssessmentExpectation: false,
      })),
      recordAssessmentRequestedChanges: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'live-test-developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedAssessmentExpectation: false,
      })),
    };
    const reviewTaskChangeService = {
      requestTaskChanges: vi.fn(async () => ({
        id: 'task-dev',
        state: 'ready',
        metadata: {
          assessment_action: 'request_changes',
          assessment_feedback: 'Add malformed-input regression coverage before approval.',
        },
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'request_changes' },
      },
      client as never,
      undefined,
      undefined,
      reviewTaskChangeService as never,
    );

    expect(reviewTaskChangeService.requestTaskChanges).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-dev',
      expect.objectContaining({
        feedback: 'Add malformed-input regression coverage before approval.',
      }),
      client,
    );
    expect(workItemContinuityService.recordAssessmentRequestedChanges).not.toHaveBeenCalled();
  });

  it('requests rework on a completed explicit subject task when an assessment handoff requests changes', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'full',
              resolution: 'request_changes',
              summary: 'QA found a regression in greeting validation.',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('state = ANY($4::task_state[])') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', ['output_pending_assessment', 'completed'], 'task-qa']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'live-test-developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-qa:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: null,
        nextExpectedAction: null,
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
      recordAssessmentRequestedChanges: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'live-test-developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedAssessmentExpectation: false,
      })),
    };
    const reviewTaskChangeService = {
      requestTaskChanges: vi.fn(async () => ({
        id: 'task-dev',
        state: 'ready',
        metadata: {
          assessment_action: 'request_changes',
          assessment_feedback: 'QA found a regression in greeting validation.',
        },
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-qa',
        workflow_id: 'workflow-1',
        work_item_id: 'verification-item',
        role: 'live-test-qa',
        stage_name: 'verification',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'request_changes' },
      },
      client as never,
      undefined,
      undefined,
      reviewTaskChangeService as never,
    );

    expect(reviewTaskChangeService.requestTaskChanges).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-dev',
      expect.objectContaining({
        feedback: 'QA found a regression in greeting validation.',
      }),
      client,
    );
    expect(workItemContinuityService.recordAssessmentRequestedChanges).not.toHaveBeenCalled();
  });

  it('rejects the explicit subject task when an assessment handoff rejects it', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'full',
              resolution: 'rejected',
              summary: 'The subject output is rejected and must not advance.',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('state = ANY($4::task_state[])') && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', ['output_pending_assessment', 'completed'], 'task-assess']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'implementation-engineer',
              state: 'output_pending_assessment',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-assess:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'assessment',
        nextExpectedActor: 'implementation-engineer',
        nextExpectedAction: 'deliver_revision',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
    };
    const reviewTaskChangeService = {
      requestTaskChanges: vi.fn(async () => ({ id: 'task-dev', state: 'ready' })),
      rejectTask: vi.fn(async () => ({ id: 'task-dev', state: 'failed' })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-assess',
        workflow_id: 'workflow-1',
        work_item_id: 'assessment-item',
        role: 'acceptance-assessor',
        stage_name: 'assessment',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'rejected' },
      },
      client as never,
      undefined,
      undefined,
      reviewTaskChangeService as never,
    );

    expect(reviewTaskChangeService.rejectTask).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'task-dev',
      expect.objectContaining({
        feedback: 'The subject output is rejected and must not advance.',
      }),
      client,
    );
    expect(reviewTaskChangeService.requestTaskChanges).not.toHaveBeenCalled();
  });

  it('does not advance assessment continuity for a blocked assessment handoff without a request-changes outcome', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'blocked',
              resolution: null,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: true,
      })),
      recordAssessmentRequestedChanges: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'developer',
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: 1,
        satisfiedAssessmentExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        rework_count: 0,
        updated_at: 'updated',
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(workItemContinuityService.recordTaskCompleted).not.toHaveBeenCalled();
    expect(workItemContinuityService.recordAssessmentRequestedChanges).not.toHaveBeenCalled();
    expect(
      client.query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO workflow_activations')),
    ).toBe(false);
  });

  it('dispatches the completion activation immediately when a playbook task finishes', async () => {
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-complete-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-dev:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-dev' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T12:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'reviewer',
        nextExpectedAction: 'assess',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-dev',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'developer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        output: { summary: 'done' },
        updated_at: 'updated',
      },
      client as never,
      activationDispatchService as never,
    );

    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-complete-1',
      client,
    );
  });

  it('does not enqueue a completion activation when the completed task already submitted a handoff', async () => {
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              completion: 'full',
              resolution: null,
              summary: 'Implementation complete.',
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          throw new Error('task.completed activation should not be enqueued when a handoff already exists');
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'reviewer',
        nextExpectedAction: 'assess',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-dev',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'developer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        rework_count: 0,
        output: { summary: 'done' },
        updated_at: 'updated',
      },
      client as never,
      activationDispatchService as never,
    );

    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(
      client.query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO workflow_activations')),
    ).toBe(false);
  });

  it('treats late task completion activation enqueue as a no-op once the workflow is already completed', async () => {
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-complete-noop',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-dev:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: { task_id: 'task-dev' },
              state: 'completed',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-17T12:00:00Z'),
              started_at: null,
              consumed_at: new Date('2026-03-17T12:00:00Z'),
              completed_at: new Date('2026-03-17T12:00:00Z'),
              summary: 'Ignored activation because workflow is already completed.',
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'reviewer',
        nextExpectedAction: 'assess',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-dev',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role: 'developer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        output: { summary: 'done' },
        updated_at: 'updated',
      },
      client as never,
      activationDispatchService as never,
    );

    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.activation_queued' }),
      client,
    );
  });

  it('auto-completes the explicit subject task across separate assessment work items', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes("AND state = 'output_pending_assessment'") && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_assessment',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_assessment'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                assessment_action: 'approved',
                assessment_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'assessment',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.state_changed',
        entityId: 'task-dev',
        actorId: 'assessment_resolver',
        data: expect.objectContaining({
          from_state: 'output_pending_assessment',
          to_state: 'completed',
          reason: 'assessment_approved',
          assessment_task_id: 'task-review',
        }),
      }),
      client,
    );
  });

  it('auto-closes a planned predecessor work item after assessment resolution completes its last open task', async () => {
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes("AND state = 'output_pending_assessment'") && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_assessment',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [{
              lifecycle: 'planned',
              definition: {
                roles: ['developer', 'reviewer'],
                lifecycle: 'planned',
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'implementation', goal: 'Ship the change' },
                  { name: 'review', goal: 'Review the change' },
                ],
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('JOIN workflow_stages ws')) {
          if (params?.[2] === 'review-item') {
            return {
              rows: [{
                stage_name: 'review',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
              }],
              rowCount: 1,
            };
          }
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [{
              stage_name: 'implementation',
              column_id: 'planned',
              completed_at: null,
              human_gate: false,
              gate_status: 'not_requested',
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT id') && sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id = $3')) {
          if (params?.[2] === 'review-item') {
            return {
              rows: [],
              rowCount: 0,
            };
          }
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item', 'review']);
          return {
            rows: [{ id: 'review-item' }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT COUNT(*)::int AS count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [{ count: 0 }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                assessment_action: 'approved',
                assessment_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE workflow_work_items')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation-item',
            'done',
            expect.any(Date),
          ]);
          return {
            rows: [{ id: 'implementation-item' }],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT ws.id') && sql.includes('FROM workflow_stages ws')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'implementation',
                position: 0,
                goal: 'Ship the change',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-19T18:00:00Z'),
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-19T18:00:00Z'),
                last_completed_work_item_at: new Date('2026-03-19T18:10:00Z'),
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'review',
                position: 1,
                goal: 'Review the change',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-19T18:11:00Z'),
                last_completed_work_item_at: null,
              },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('UPDATE workflow_stages')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.completed',
        entityId: 'implementation-item',
        actorId: 'task_completion_side_effects',
      }),
      client,
    );
  });

  it('skips assessment resolution when the subject task linkage is missing', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_assessment'")) {
          if (params?.[2] === 'review-item') {
            return { rows: [], rowCount: 0 };
          }
          if (params?.[2] === 'implementation-item') {
            return {
              rows: [{
                id: 'task-dev',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                work_item_id: 'implementation-item',
                role: 'developer',
                state: 'output_pending_assessment',
                output: { summary: 'done' },
                metadata: {},
              }],
              rowCount: 1,
            };
          }
        }
        if (sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'review-item']);
          return {
            rows: [{ parent_work_item_id: 'implementation-item' }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                assessment_action: 'approved',
                assessment_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'review',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: true,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: {},
        metadata: { task_kind: 'assessment' },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.assessment_resolution_skipped',
        entityId: 'task-review',
        actorId: 'assessment_resolver',
        data: expect.objectContaining({
          reason: 'missing_subject_task_id',
          resolution_gate: 'missing_subject_task_id',
        }),
      }),
      client,
    );
  });

  it('auto-completes the explicit subject task for an assessment even when continuity did not mark an assessment expectation', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM tasks\n     WHERE tenant_id = $1 AND state = 'pending'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT playbook_id FROM workflows')) {
          return { rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM tasks') && sql.includes("AND state = 'output_pending_assessment'") && sql.includes('AND id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'task-dev', 'task-review']);
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              role: 'developer',
              state: 'output_pending_assessment',
              output: { summary: 'done' },
              metadata: {},
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_activations')) {
          return {
            rows: [{
              id: 'activation-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'task-completed:task-review:updated',
              reason: 'task.completed',
              event_type: 'task.completed',
              payload: {},
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date(),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE tasks')) {
          return {
            rows: [{
              id: 'task-dev',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'implementation-item',
              workspace_id: 'workspace-1',
              role: 'developer',
              state: 'completed',
              output: { summary: 'done' },
              metadata: {
                assessment_action: 'approved',
                assessment_resolved_by_task_id: 'task-review',
              },
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-review',
        workflow_id: 'workflow-1',
        work_item_id: 'review-item',
        role: 'reviewer',
        stage_name: 'review',
        is_orchestrator_task: false,
        input: { subject_task_id: 'task-dev', subject_revision: 1 },
        metadata: { task_kind: 'assessment', subject_task_id: 'task-dev', subject_revision: 1 },
        output: { verdict: 'approved' },
      },
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.assessment_resolution_applied',
        entityId: 'task-review',
        actorId: 'assessment_resolver',
        data: expect.objectContaining({
          subject_task_id: 'task-dev',
          resolution_source: 'explicit_subject_task_id',
          resolution_gate: 'explicit_subject_task_id',
        }),
      }),
      client,
    );
  });

  it('logs when assessment resolution is skipped before candidate lookup starts', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 })),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const logService = {
      insert: vi.fn(async () => undefined),
    };
    const workItemContinuityService = {
      recordTaskCompleted: vi.fn(async () => ({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
        requiresHumanApproval: false,
        reworkDelta: 0,
        satisfiedAssessmentExpectation: false,
      })),
    };

    await applyTaskCompletionSideEffects(
      eventService as never,
      undefined,
      workItemContinuityService as never,
      {
        id: 'agent-key',
        tenantId: 'tenant-1',
        scope: 'agent',
        ownerType: 'agent',
        ownerId: 'agent-1',
        keyPrefix: 'agent-key',
      },
      {
        id: 'task-dev',
        workflow_id: 'workflow-1',
        work_item_id: 'implementation-item',
        role: 'developer',
        stage_name: 'implementation',
        is_orchestrator_task: false,
        input: {},
        output: { summary: 'done' },
      },
      client as never,
      undefined,
      logService as never,
    );

    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.assessment_resolution.skipped',
        taskId: 'task-dev',
        workItemId: 'implementation-item',
        stageName: 'implementation',
        role: 'developer',
        payload: expect.objectContaining({
          event_type: 'task.assessment_resolution_skipped',
          reason: 'not_assessment_candidate',
          resolution_gate: 'not_assessment_candidate',
        }),
      }),
    );
  });
});
