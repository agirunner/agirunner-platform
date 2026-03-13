import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(descriptor.emphasisLabel).toBe('Board work');
    expect(descriptor.scopeSummary).toContain('Stage implementation');
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

    expect(descriptor.headline).toBe('Request changes gate for design');
    expect(descriptor.summary).toContain('Clarify the runtime credential flow');
    expect(descriptor.emphasisLabel).toBe('Gate decision');
    expect(descriptor.emphasisTone).toBe('warning');
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
    );

    expect(descriptor.headline).toBe('Workflow budget warning');
    expect(descriptor.summary).toContain('Approaching configured workflow guardrails');
    expect(descriptor.summary).toContain('tokens (96,000 / 120,000)');
    expect(descriptor.summary).toContain('cost ($9.5000 / $12.0000)');
    expect(descriptor.emphasisLabel).toBe('Budget');
    expect(descriptor.signalBadges).toContain('tokens guardrail');
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
    );

    expect(descriptor.headline).toBe('Workflow budget exceeded');
    expect(descriptor.summary).toContain('Configured workflow guardrails were exceeded');
    expect(descriptor.summary).toContain('duration (105.00 min / 90.00 min)');
  });

  it('renders timeline entries as interaction packets with reviewed payload drill-down', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-history-card.tsx'),
      'utf8',
    );

    expect(source).toContain('descriptor.emphasisLabel');
    expect(source).toContain('descriptor.scopeSummary');
    expect(source).toContain('descriptor.signalBadges');
    expect(source).toContain('Gate decision');
    expect(source).toContain('Interaction packet');
    expect(source).toContain('describeReviewPacket');
    expect(source).toContain('readPacketScalarFacts');
    expect(source).toContain('Open event packet');
    expect(source).not.toContain('>Event payload<');
  });
});
