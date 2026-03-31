import { describe, expect, it } from 'vitest';

import type { DashboardEventRecord } from '../../lib/api.js';
import { buildTimelineContext, describeTimelineEvent } from './workflow-history-card.js';

function buildEvent(overrides: Partial<DashboardEventRecord>): DashboardEventRecord {
  return {
    id: 'event-1',
    type: 'workflow.created',
    entity_type: 'workflow',
    entity_id: 'workflow-1',
    actor_type: 'orchestrator',
    actor_id: 'task-1',
    data: {},
    created_at: '2026-03-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('workflow interaction timeline', () => {
  const context = buildTimelineContext({
    activations: [],
    childWorkflows: [
      {
        workflow_id: 'workflow-child-2',
        name: 'Child validation run',
        state: 'completed',
        playbook_id: null,
        playbook_name: null,
        created_at: null,
        started_at: null,
        completed_at: null,
        is_terminal: true,
        link: '/work/boards/workflow-child-2',
      },
    ],
    stages: [
      {
        id: 'stage-1',
        name: 'implementation',
        position: 2,
        goal: 'Build the feature.',
        status: 'active',
        is_active: true,
        gate_status: 'not_requested',
        iteration_count: 0,
        open_work_item_count: 1,
        total_work_item_count: 1,
      },
    ],
    tasks: [
      {
        id: 'task-9',
        title: 'Implement OAuth callback flow',
        state: 'completed',
        depends_on: [],
        work_item_id: 'wi-1',
        role: 'architect',
        stage_name: 'implementation',
      },
    ],
    workItems: [
      {
        id: 'wi-1',
        workflow_id: 'workflow-1',
        stage_name: 'implementation',
        title: 'Implement OAuth callback flow',
        column_id: 'doing',
        priority: 'high',
      },
    ],
  });

  it('describes work item creation with human-readable work context', () => {
    const descriptor = describeTimelineEvent(
      buildEvent({
        type: 'work_item.created',
        data: {
          work_item_title: 'Implement OAuth callback flow',
          goal: 'Handle provider redirects and persist encrypted tokens.',
          stage_name: 'implementation',
          work_item_id: 'wi-1',
        },
      }),
      context,
    );

    expect(descriptor.headline).toBe('Created work item Implement OAuth callback flow');
    expect(descriptor.narrativeHeadline).toBe(
      'Orchestrator opened work item Implement OAuth callback flow',
    );
    expect(descriptor.summary).toContain('Handle provider redirects');
    expect(descriptor.stageName).toBe('implementation');
    expect(descriptor.workItemId).toBe('wi-1');
    expect(descriptor.emphasisLabel).toBe('Board work');
    expect(descriptor.actorLabel).toBe('Orchestrator');
    expect(descriptor.scopeSummary).toContain('Work item Implement OAuth callback flow');
  });

  it('describes stage-gate decisions instead of exposing raw event codes', () => {
    const descriptor = describeTimelineEvent(
      buildEvent({
        type: 'stage.gate.request_changes',
        data: {
          stage_name: 'design',
          feedback: 'Clarify the runtime credential flow before approval.',
        },
      }),
      context,
    );

    expect(descriptor.headline).toBe('Request changes gate for design');
    expect(descriptor.narrativeHeadline).toBe(
      'Orchestrator requested changes on the gate design',
    );
    expect(descriptor.outcomeLabel).toContain('Clarify the runtime credential flow');
    expect(descriptor.emphasisLabel).toBe('Gate decision');
    expect(descriptor.emphasisTone).toBe('warning');
    expect(descriptor.gateStageName).toBe('design');
  });

  it('describes workflow budget warnings with operator-readable usage details', () => {
    const descriptor = describeTimelineEvent(
      buildEvent({
        type: 'budget.warning',
        actor_type: 'system',
        actor_id: 'workflow_budget_policy',
        data: {
          dimensions: ['tokens', 'cost'],
          tokens_used: 96000,
          tokens_limit: 120000,
          cost_usd: 9.5,
          cost_limit_usd: 12,
        },
      }),
      context,
    );

    expect(descriptor.headline).toBe('Workflow budget warning');
    expect(descriptor.summary).toContain('Approaching configured workflow guardrails');
    expect(descriptor.summary).toContain('tokens (96,000 / 120,000)');
    expect(descriptor.summary).toContain('cost ($9.5000 / $12.0000)');
    expect(descriptor.emphasisLabel).toBe('Budget');
    expect(descriptor.signalBadges).toContain('Tokens guardrail');
  });

  it('describes workflow budget exceedances with human-readable overage context', () => {
    const descriptor = describeTimelineEvent(
      buildEvent({
        type: 'budget.exceeded',
        actor_type: 'system',
        actor_id: 'workflow_budget_policy',
        data: {
          dimensions: ['duration'],
          elapsed_minutes: 105,
          duration_limit_minutes: 90,
        },
      }),
      context,
    );

    expect(descriptor.headline).toBe('Workflow budget exceeded');
    expect(descriptor.summary).toContain('Configured workflow guardrails were exceeded');
    expect(descriptor.summary).toContain('duration (105.00 min / 90.00 min)');
  });

  it('describes specialist outcomes with role-aware actor lanes and deep-link context', () => {
    const descriptor = describeTimelineEvent(
      buildEvent({
        type: 'task.completed',
        actor_type: 'task',
        actor_id: 'task-9',
        entity_type: 'task',
        entity_id: 'task-9',
        data: {
          task_id: 'task-9',
          work_item_id: 'wi-1',
          stage_name: 'implementation',
          summary: 'OAuth callback flow merged and verified.',
        },
      }),
      context,
    );

    expect(descriptor.actorLabel).toBe('Architect specialist');
    expect(descriptor.narrativeHeadline).toBe(
      'Architect specialist completed specialist step Implement OAuth callback flow',
    );
    expect(descriptor.taskId).toBe('task-9');
    expect(descriptor.workItemId).toBe('wi-1');
    expect(descriptor.scopeSummary).toContain('Step Implement OAuth callback flow');
  });

  it('treats orchestrator-owned agent lifecycle events as orchestrator activity', () => {
    const descriptor = describeTimelineEvent(
      buildEvent({
        type: 'workflow.state_changed',
        actor_type: 'agent',
        actor_id: 'agent-1',
        data: {
          from_state: 'pending',
          to_state: 'active',
          role: 'orchestrator',
          is_orchestrator_task: true,
          stage_name: 'implementation',
        },
      }),
      context,
    );

    expect(descriptor.actorLabel).toBe('Orchestrator');
    expect(descriptor.narrativeHeadline).toContain('Orchestrator');
    expect(descriptor.scopeSummary).toContain('Actor Orchestrator');
    expect(descriptor.stageName).toBe('implementation');
  });
});
