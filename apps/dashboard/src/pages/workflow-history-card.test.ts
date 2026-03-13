import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DashboardEventRecord } from '../lib/api.js';
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
        link: '/work/workflows/workflow-child-2',
      },
    ],
    stages: [
      {
        id: 'stage-1',
        name: 'implementation',
        position: 2,
        goal: 'Build the feature.',
        human_gate: false,
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

  it('renders timeline entries as actor-lane packets with reviewed payload drill-down', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-history-card.tsx'),
      'utf8',
    );

    expect(source).toContain('descriptor.actorLabel');
    expect(source).toContain('descriptor.outcomeLabel');
    expect(source).toContain('descriptor.emphasisLabel');
    expect(source).toContain('descriptor.scopeSummary');
    expect(source).toContain('descriptor.signalBadges');
    expect(source).toContain('TimelineEventPacket');
    expect(source).toContain('buildTimelineEntryActions');
    expect(source).not.toContain('Event payload');
  });

  it('uses filter, sort, pagination, and saved-view controls in the interaction timeline card', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-history-card.tsx'),
      'utf8',
    );

    expect(source).toContain('WorkItemHistoryFilterBar');
    expect(source).toContain('WorkItemHistoryPagination');
    expect(source).toContain('filterAndSortTimelineRecords');
    expect(source).toContain('paginateTimelineRecords');
    expect(source).toContain('savedViewStorageKey');
    expect(source).toContain('onApplySavedView');
    expect(source).toContain('loadPersistedTimelineFilters');
    expect(source).toContain('persistTimelineFilters');
  });

  it('uses relative timestamps with absolute tooltip instead of toLocaleString', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-history-card.tsx'),
      'utf8',
    );

    expect(source).toContain('formatRelativeTimestamp');
    expect(source).toContain('title={event.created_at}');
    expect(source).not.toContain('toLocaleString');
    expect(source).not.toContain('formatTimestamp');
  });

  it('uses a debounced search input in the filter bar controls', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-work-item-history-controls.tsx'),
      'utf8',
    );

    expect(source).toContain('DebouncedSearchInput');
    expect(source).toContain('SEARCH_DEBOUNCE_MS');
    expect(source).toContain('setTimeout');
    expect(source).toContain('clearTimeout');
  });
});
