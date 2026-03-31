import { describe, expect, it } from 'vitest';

import {
  buildActivationActivity,
  deriveContinuousStageStatus,
  sanitizeWorkflowSummary,
} from '../../../src/services/playbook-run-summary/playbook-run-summary-support.js';
import type {
  TimelineEventRow,
  WorkflowActivationSummaryRow,
  WorkflowStageSummaryRow,
  WorkflowWorkItemSummaryRow,
} from '../../../src/services/playbook-run-summary/playbook-run-summary.types.js';

function buildStage(overrides: Partial<WorkflowStageSummaryRow> = {}): WorkflowStageSummaryRow {
  return {
    name: 'review',
    goal: 'Review work',
    status: 'pending',
    gate_status: 'not_requested',
    iteration_count: 0,
    summary: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function buildWorkItem(
  overrides: Partial<WorkflowWorkItemSummaryRow> = {},
): WorkflowWorkItemSummaryRow {
  return {
    id: 'wi-1',
    stage_name: 'review',
    column_id: 'queued',
    title: 'Review',
    completed_at: null,
    ...overrides,
  };
}

function buildActivation(
  overrides: Partial<WorkflowActivationSummaryRow> = {},
): WorkflowActivationSummaryRow {
  return {
    activation_id: 'activation-1',
    state: 'processing',
    reason: 'queued_events',
    event_type: 'task.updated',
    task_id: 'task-1',
    queued_at: new Date('2026-03-10T00:00:00.000Z'),
    started_at: new Date('2026-03-10T00:01:00.000Z'),
    consumed_at: null,
    completed_at: null,
    error: null,
    ...overrides,
  };
}

function buildEvent(overrides: Partial<TimelineEventRow> = {}): TimelineEventRow {
  return {
    type: 'workflow.activation_started',
    actor_type: 'system',
    actor_id: 'dispatcher',
    data: {
      activation_id: 'activation-1',
      event_type: 'task.updated',
      event_count: 1,
    },
    created_at: new Date('2026-03-10T00:01:00.000Z'),
    ...overrides,
  };
}

describe('playbook run summary support', () => {
  it('derives blocked and active continuous stage states from gates and work items', () => {
    expect(
      deriveContinuousStageStatus(buildStage({ gate_status: 'rejected' }), [buildWorkItem()]),
    ).toBe('blocked');
    expect(
      deriveContinuousStageStatus(buildStage(), [buildWorkItem()]),
    ).toBe('active');
    expect(
      deriveContinuousStageStatus(buildStage({ gate_status: 'approved' }), []),
    ).toBe('pending');
  });

  it('builds activation activity from activation rows and workflow activation events', () => {
    const activity = buildActivationActivity(
      [
        buildActivation(),
        buildActivation({
          activation_id: 'activation-2',
          state: 'completed',
          event_type: 'child_workflow.completed',
          task_id: null,
          started_at: new Date('2026-03-10T00:03:00.000Z'),
          completed_at: new Date('2026-03-10T00:04:00.000Z'),
          error: { recovery: { status: 'stale_detected' } },
        }),
      ],
      [
        buildEvent(),
        buildEvent({
          type: 'workflow.activation_completed',
          data: {
            activation_id: 'activation-2',
            event_type: 'child_workflow.completed',
            event_count: 1,
          },
          created_at: new Date('2026-03-10T00:04:00.000Z'),
        }),
      ],
    );

    expect(activity).toEqual(
      expect.objectContaining({
        total_events: 2,
        started_count: 2,
        completed_count: 1,
        stale_detected_count: 1,
        latest_activation_id: 'activation-2',
      }),
    );
  });

  it('redacts embedded secrets from workflow summaries', () => {
    expect(
      sanitizeWorkflowSummary({
        stage_summary: 'Use Bearer sk-live-secret',
      }),
    ).toEqual({
      stage_summary: 'redacted://workflow-summary-secret',
    });
  });
});
