import { describe, expect, it } from 'vitest';

import type { DashboardEventRecord } from '../lib/api.js';
import { describeTimelineEvent } from './workflow-history-card.js';

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
    );

    expect(descriptor.headline).toBe('Created work item Implement OAuth callback flow');
    expect(descriptor.summary).toContain('Handle provider redirects');
    expect(descriptor.stageName).toBe('implementation');
    expect(descriptor.workItemId).toBe('wi-1');
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
    );

    expect(descriptor.headline).toBe('request changes gate for design');
    expect(descriptor.summary).toContain('Clarify the runtime credential flow');
  });
});
