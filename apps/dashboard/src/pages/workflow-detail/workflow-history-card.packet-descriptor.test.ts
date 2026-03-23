import { describe, expect, it } from 'vitest';

import type { DashboardEventRecord } from '../../lib/api.js';
import { buildTimelineContext, describeTimelineEvent } from './workflow-history-card.js';
import { describeTimelineEventPacket } from './workflow-history-card.packet.support.js';

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

const context = buildTimelineContext({
  activations: [
    {
      id: 'activation-3',
      workflow_id: 'workflow-1',
      activation_id: 'activation-3',
      event_type: 'workflow.activation_queued',
      payload: {},
      state: 'queued',
      reason: 'Review changes requested by the human gate.',
      queued_at: '2026-03-12T10:05:00.000Z',
      started_at: null,
      completed_at: null,
      events: [],
      summary: null,
    },
  ],
  childWorkflows: [],
  stages: [
    {
      id: 'stage-1',
      name: 'implementation',
      position: 1,
      goal: 'Build the fix.',
      human_gate: true,
      status: 'active',
      is_active: true,
      gate_status: 'requested',
      iteration_count: 0,
      open_work_item_count: 1,
      total_work_item_count: 1,
    },
  ],
  tasks: [
    {
      id: 'task-9',
      title: 'Implement OAuth callback flow',
      state: 'failed',
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
      owner_role: 'architect',
    },
  ],
});

describe('describeTimelineEventPacket', () => {
  it('curates activation packets with operator-facing trigger facts', () => {
    const event = buildEvent({
      type: 'workflow.activation_queued',
      data: {
        activation_id: 'activation-3',
        reason: 'Review changes requested by the human gate.',
        source: 'stage_gate',
        stage_name: 'implementation',
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Activation');
    expect(packet.summary).toContain('wake-up is queued');
    expect(packet.detail).toContain('Review changes requested by the human gate');
    expect(packet.facts).toEqual(
      expect.arrayContaining([
        { label: 'Activation', value: 'activation-3' },
        { label: 'Trigger', value: 'stage gate' },
        { label: 'Stage', value: 'implementation' },
      ]),
    );
    expect(packet.disclosureLabel).toBe('Open full activation packet');
  });

  it('summarizes specialist failures with curated role and scope facts', () => {
    const event = buildEvent({
      type: 'task.failed',
      actor_type: 'task',
      actor_id: 'task-9',
      entity_type: 'task',
      entity_id: 'task-9',
      data: {
        task_id: 'task-9',
        work_item_id: 'wi-1',
        stage_name: 'implementation',
        error: 'OpenAI callback token verification failed during replay.',
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Specialist step');
    expect(packet.summary).toContain('needs recovery');
    expect(packet.detail).toContain('token verification failed');
    expect(packet.facts).toEqual(
      expect.arrayContaining([
        { label: 'Step', value: 'Implement OAuth callback flow' },
        { label: 'Role', value: 'Architect' },
        { label: 'Stage', value: 'implementation' },
        { label: 'Work item', value: 'Implement OAuth callback flow' },
      ]),
    );
    expect(packet.disclosureLabel).toBe('Open full step packet');
  });

  it('turns handoff events into explicit handoff packets', () => {
    const event = buildEvent({
      type: 'task.handoff_submitted',
      actor_type: 'task',
      actor_id: 'task-9',
      entity_type: 'task',
      entity_id: 'task-9',
      data: {
        task_id: 'task-9',
        work_item_id: 'wi-1',
        stage_name: 'implementation',
        role: 'architect',
        summary: 'Verified the callback flow and handed off the release notes.',
        completion: 'completed',
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Handoff');
    expect(packet.summary).toBe('Implement OAuth callback flow submitted a specialist handoff.');
    expect(packet.detail).toContain('handed off the release notes');
    expect(packet.facts).toEqual(
      expect.arrayContaining([
        { label: 'Step', value: 'Implement OAuth callback flow' },
        { label: 'Role', value: 'Architect' },
        { label: 'Stage', value: 'implementation' },
        { label: 'Work item', value: 'Implement OAuth callback flow' },
      ]),
    );
    expect(packet.disclosureLabel).toBe('Open full handoff packet');
  });

  it('turns assessment resolution events into explicit assessment packets', () => {
    const event = buildEvent({
      type: 'task.assessment_resolution_applied',
      actor_type: 'task',
      actor_id: 'task-9',
      entity_type: 'task',
      entity_id: 'task-9',
      data: {
        task_id: 'task-9',
        work_item_id: 'wi-1',
        stage_name: 'implementation',
        role: 'architect',
        summary: 'Applied the requested review edits before rerunning checks.',
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Assessment resolution');
    expect(packet.summary).toBe('Implement OAuth callback flow applied assessment resolution.');
    expect(packet.detail).toContain('requested review edits');
    expect(packet.disclosureLabel).toBe('Open full assessment packet');
  });

  it('turns retry and rework events into explicit recovery packets', () => {
    const retryEvent = buildEvent({
      type: 'task.retry_scheduled',
      actor_type: 'task',
      actor_id: 'task-9',
      entity_type: 'task',
      entity_id: 'task-9',
      data: {
        task_id: 'task-9',
        work_item_id: 'wi-1',
        stage_name: 'implementation',
        role: 'architect',
        reason: 'Retry after refreshing the callback secret.',
      },
    });
    const reworkEvent = buildEvent({
      type: 'task.max_rework_exceeded',
      actor_type: 'task',
      actor_id: 'task-9',
      entity_type: 'task',
      entity_id: 'task-9',
      data: {
        task_id: 'task-9',
        work_item_id: 'wi-1',
        stage_name: 'implementation',
        role: 'architect',
        reason: 'The callback fix exceeded the allowed rework limit.',
      },
    });

    const retryPacket = describeTimelineEventPacket(retryEvent, describeTimelineEvent(retryEvent, context));
    const reworkPacket = describeTimelineEventPacket(reworkEvent, describeTimelineEvent(reworkEvent, context));

    expect(retryPacket.typeLabel).toBe('Recovery');
    expect(retryPacket.summary).toBe('Implement OAuth callback flow scheduled another execution attempt.');
    expect(retryPacket.detail).toContain('refreshing the callback secret');
    expect(retryPacket.disclosureLabel).toBe('Open full recovery packet');

    expect(reworkPacket.typeLabel).toBe('Recovery');
    expect(reworkPacket.summary).toBe('Implement OAuth callback flow exceeded the allowed rework limit.');
    expect(reworkPacket.detail).toContain('allowed rework limit');
    expect(reworkPacket.disclosureLabel).toBe('Open full recovery packet');
  });

  it('turns escalation events into explicit escalation packets', () => {
    const event = buildEvent({
      type: 'task.escalation_response_recorded',
      actor_type: 'operator',
      actor_id: 'user-1',
      entity_type: 'task',
      entity_id: 'task-9',
      data: {
        task_id: 'task-9',
        work_item_id: 'wi-1',
        stage_name: 'implementation',
        role: 'architect',
        summary: 'Operator approved the emergency rollout path.',
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Escalation');
    expect(packet.summary).toBe('Implement OAuth callback flow received an escalation response.');
    expect(packet.detail).toContain('emergency rollout path');
    expect(packet.disclosureLabel).toBe('Open full escalation packet');
  });

  it('turns stage gate packets into explicit decision summaries', () => {
    const event = buildEvent({
      type: 'stage.gate.request_changes',
      data: {
        stage_name: 'implementation',
        feedback: 'Clarify token refresh ownership before approval.',
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Gate decision');
    expect(packet.summary).toBe('implementation gate: changes requested.');
    expect(packet.detail).toContain('Clarify token refresh ownership');
    expect(packet.facts).toEqual(
      expect.arrayContaining([
        { label: 'Stage', value: 'implementation' },
        { label: 'Decision', value: 'Changes requested' },
        { label: 'Actor', value: 'Orchestrator' },
      ]),
    );
    expect(packet.disclosureLabel).toBe('Open full gate packet');
  });

  it('keeps budget packets human-readable without leaking raw payload ids into facts', () => {
    const event = buildEvent({
      type: 'budget.warning',
      actor_type: 'system',
      data: {
        workflow_id: 'workflow-1',
        activation_id: 'activation-3',
        dimensions: ['tokens', 'cost'],
        tokens_used: 96000,
        tokens_limit: 120000,
        cost_usd: 9.5,
        cost_limit_usd: 12,
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Budget guardrail');
    expect(packet.summary).toContain('Approaching configured workflow guardrails');
    expect(packet.detail).toContain('tokens, cost');
    expect(packet.facts).toEqual(
      expect.arrayContaining([
        { label: 'Dimensions', value: 'tokens, cost' },
        { label: 'Severity', value: 'Warning' },
      ]),
    );
  });

  it('falls back to generic facts while filtering redundant ids from unknown events', () => {
    const event = buildEvent({
      type: 'workflow.custom_signal',
      data: {
        workflow_id: 'workflow-1',
        activation_id: 'activation-3',
        retry_count: 2,
        scope: 'implementation',
        status_code: 409,
      },
    });

    const packet = describeTimelineEventPacket(event, describeTimelineEvent(event, context));

    expect(packet.typeLabel).toBe('Board status');
    expect(packet.facts).toEqual([
      { label: 'Retry count', value: '2' },
      { label: 'Scope', value: 'implementation' },
      { label: 'Status code', value: '409' },
    ]);
  });
});
