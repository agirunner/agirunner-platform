import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { curatePacketFacts } from './workflow-history-card.packet.support.js';

describe('curatePacketFacts', () => {
  it('suppresses internal IDs from task.completed payloads', () => {
    const facts = curatePacketFacts('task.completed', {
      task_id: 'task-9',
      work_item_id: 'wi-1',
      stage_name: 'implementation',
      summary: 'OAuth callback flow merged and verified.',
    });

    const labels = facts.map((f) => f.label);
    expect(labels).not.toContain('task id');
    expect(labels).not.toContain('work item id');
    expect(labels).not.toContain('stage name');
    expect(facts).toEqual([{ label: 'Summary', value: 'OAuth callback flow merged and verified.' }]);
  });

  it('promotes specialist role for task.completed when present', () => {
    const facts = curatePacketFacts('task.completed', {
      task_id: 'task-9',
      work_item_id: 'wi-1',
      stage_name: 'implementation',
      role: 'architect',
      summary: 'OAuth callback flow merged and verified.',
    });

    expect(facts[0]).toEqual({ label: 'Specialist role', value: 'architect' });
    expect(facts[1]).toEqual({ label: 'Summary', value: 'OAuth callback flow merged and verified.' });
  });

  it('promotes priority for work_item.created payloads', () => {
    const facts = curatePacketFacts('work_item.created', {
      work_item_id: 'wi-1',
      work_item_title: 'Implement OAuth',
      stage_name: 'implementation',
      goal: 'Handle provider redirects.',
      priority: 'high',
    });

    expect(facts[0]).toEqual({ label: 'Priority', value: 'high' });
    expect(facts[1]).toEqual({ label: 'Goal', value: 'Handle provider redirects.' });
  });

  it('promotes from_state and to_state for workflow.state_changed', () => {
    const facts = curatePacketFacts('workflow.state_changed', {
      from_state: 'planning',
      to_state: 'active',
      reason: 'All planning gates approved.',
      workflow_id: 'wf-1',
    });

    expect(facts[0]).toEqual({ label: 'Previous state', value: 'planning' });
    expect(facts[1]).toEqual({ label: 'New state', value: 'active' });
    expect(facts[2]).toEqual({ label: 'Reason', value: 'All planning gates approved.' });
    expect(facts).toHaveLength(3);
  });

  it('promotes previous column for work_item.moved', () => {
    const facts = curatePacketFacts('work_item.moved', {
      work_item_id: 'wi-1',
      column_id: 'col-2',
      to_column_id: 'col-3',
      from_column_label: 'To Do',
      to_column_label: 'In Progress',
      stage_name: 'implementation',
    });

    expect(facts[0]).toEqual({ label: 'Previous column', value: 'To Do' });
    expect(facts[1]).toEqual({ label: 'Destination column', value: 'In Progress' });
    expect(facts).toHaveLength(2);
  });

  it('uses curated labels for known keys in backfill', () => {
    const facts = curatePacketFacts('stage.gate.reject', {
      feedback: 'Missing test coverage for edge cases.',
      stage_name: 'review',
    });

    expect(facts).toEqual([{ label: 'Feedback', value: 'Missing test coverage for edge cases.' }]);
  });

  it('humanizes unknown keys when no curated label exists', () => {
    const facts = curatePacketFacts('custom.event', {
      retry_count: 3,
      failure_category: 'timeout',
    });

    expect(facts).toContainEqual({ label: 'Failure category', value: 'timeout' });
    expect(facts).toContainEqual({ label: 'Retry count', value: '3' });
  });

  it('excludes empty strings and null values', () => {
    const facts = curatePacketFacts('task.completed', {
      role: '',
      summary: null,
      notes: '   ',
      outcome: 'passed',
    });

    expect(facts).toEqual([{ label: 'Outcome', value: 'passed' }]);
  });

  it('formats booleans and numbers as strings', () => {
    const facts = curatePacketFacts('custom.event', {
      is_retry: true,
      attempt_count: 5,
    });

    expect(facts).toContainEqual({ label: 'Attempt count', value: '5' });
    expect(facts).toContainEqual({ label: 'Is retry', value: 'true' });
  });

  it('truncates long string values at 96 characters', () => {
    const longValue = 'A'.repeat(120);
    const facts = curatePacketFacts('custom.event', { description: longValue });

    expect(facts[0].value).toHaveLength(96);
    expect(facts[0].value).toMatch(/\.\.\.$/);
  });

  it('respects the limit parameter', () => {
    const facts = curatePacketFacts(
      'custom.event',
      {
        alpha: 'a',
        bravo: 'b',
        charlie: 'c',
        delta: 'd',
        echo: 'e',
      },
      2,
    );

    expect(facts).toHaveLength(2);
  });

  it('returns empty array for null or undefined data', () => {
    expect(curatePacketFacts('task.completed', null)).toEqual([]);
    expect(curatePacketFacts('task.completed', undefined)).toEqual([]);
  });

  it('returns empty array for empty object', () => {
    expect(curatePacketFacts('task.completed', {})).toEqual([]);
  });

  it('skips non-scalar values like arrays and objects', () => {
    const facts = curatePacketFacts('custom.event', {
      tags: ['alpha', 'bravo'],
      metadata: { nested: true },
      label: 'visible',
    });

    expect(facts).toEqual([{ label: 'Label', value: 'visible' }]);
  });

  it('suppresses assigned_role as a duplicate of role', () => {
    const facts = curatePacketFacts('task.created', {
      role: 'engineer',
      assigned_role: 'engineer',
      task_id: 'task-1',
    });

    const labels = facts.map((f) => f.label);
    expect(labels).not.toContain('Assigned role');
    expect(facts).toContainEqual({ label: 'Specialist role', value: 'engineer' });
  });

  it('suppresses budget dimension keys already consumed by narrative summary', () => {
    const facts = curatePacketFacts('budget.warning', {
      dimensions: ['tokens', 'cost'],
      tokens_used: 96000,
      tokens_limit: 120000,
      cost_usd: 9.5,
      cost_limit_usd: 12,
      policy_name: 'default_guardrails',
    });

    const labels = facts.map((f) => f.label);
    expect(labels).not.toContain('Dimensions');
    expect(facts).toContainEqual({ label: 'Policy name', value: 'default_guardrails' });
  });

  it('promotes escalation fields for task.escalated', () => {
    const facts = curatePacketFacts('task.escalated', {
      task_id: 'task-5',
      role: 'reviewer',
      severity: 'critical',
      reason: 'Unresolvable merge conflict.',
    });

    expect(facts[0]).toEqual({ label: 'Specialist role', value: 'reviewer' });
    expect(facts[1]).toEqual({ label: 'Severity', value: 'critical' });
    expect(facts[2]).toEqual({ label: 'Reason', value: 'Unresolvable merge conflict.' });
  });
});

describe('workflow-history-card.packet.tsx integration', () => {
  it('uses curatePacketFacts instead of generic readPacketScalarFacts', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-history-card.packet.tsx'),
      'utf8',
    );

    expect(source).toContain('curatePacketFacts');
    expect(source).toContain('props.event.type');
    expect(source).not.toContain('readPacketScalarFacts');
  });
});
