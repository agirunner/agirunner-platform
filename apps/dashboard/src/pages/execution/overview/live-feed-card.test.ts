import { describe, it, expect } from 'vitest';
import { LiveFeedCard, formatEventSummary } from './live-feed-card.js';

describe('LiveFeedCard', () => {
  it('exports LiveFeedCard as a function', () => {
    expect(typeof LiveFeedCard).toBe('function');
  });
});

describe('formatEventSummary', () => {
  it('formats task completed event', () => {
    const event = { type: 'task.completed', entityType: 'task', data: { task_title: 'review code' } };
    expect(formatEventSummary(event)).toContain('review code');
  });

  it('formats task started event', () => {
    const event = { type: 'task.started', data: { task_title: 'implement feature' } };
    expect(formatEventSummary(event)).toContain('implement feature');
  });

  it('formats task failed event', () => {
    const event = { type: 'task.failed', data: { task_title: 'deploy app' } };
    expect(formatEventSummary(event)).toContain('deploy app');
  });

  it('formats workflow started event', () => {
    const event = { type: 'workflow.started', data: { workflow_name: 'Sprint 42' } };
    expect(formatEventSummary(event)).toContain('Sprint 42');
  });

  it('formats workflow completed event', () => {
    const event = { type: 'workflow.completed', data: { workflow_name: 'Sprint 42' } };
    expect(formatEventSummary(event)).toContain('Sprint 42');
  });

  it('formats gate approved event', () => {
    const event = { type: 'gate.approved', data: { gate_name: 'QA Gate' } };
    expect(formatEventSummary(event)).toContain('QA Gate');
  });

  it('handles missing task_title gracefully', () => {
    const event = { type: 'task.completed', data: {} };
    expect(formatEventSummary(event)).toBe('Task completed: unknown task');
  });

  it('handles unknown event type', () => {
    const event = { type: 'custom.event', entityType: 'workflow' };
    const result = formatEventSummary(event);
    expect(result).toBe('Custom event');
  });

  it('handles unknown event type without entityType', () => {
    const event = { type: 'some.event' };
    const result = formatEventSummary(event);
    expect(result).toBe('Some event');
  });

  it('handles missing data field', () => {
    const event = { type: 'task.completed' };
    expect(formatEventSummary(event)).toBe('Task completed: unknown task');
  });

  it('enriches task state change from taskNameMap', () => {
    const taskNames = new Map([['t1', { title: 'Write tests', role: 'qa' }]]);
    const event = { type: 'task.state_changed', data: { to_state: 'in_progress', task_id: 't1' } };
    const result = formatEventSummary(event, taskNames);
    expect(result).toContain('Write tests');
    expect(result).toContain('qa');
  });

  it('shows escalation reason for agent_escalated events', () => {
    const event = { type: 'task.agent_escalated', data: { reason: 'Need human review' } };
    const result = formatEventSummary(event);
    expect(result).toContain('Need human review');
  });

  it('falls back when taskNameMap has no entry for task_id', () => {
    const taskNames = new Map<string, { title: string; role: string }>();
    const event = { type: 'task.state_changed', data: { to_state: 'completed', task_id: 'unknown' } };
    const result = formatEventSummary(event, taskNames);
    expect(result).toBe('Task completed');
  });
});
