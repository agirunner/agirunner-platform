import { describe, expect, it } from 'vitest';

import type { LogEntry } from '../../lib/api.js';
import {
  describeLogActivityDetail,
  describeLogActivityTitle,
  describeLogActorDetail,
  describeLogActorLabel,
  describeWorkflowStageSummary,
} from './log-entry-presentation.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 1,
    trace_id: 'trace-1',
    span_id: 'span-1',
    source: 'runtime_worker',
    category: 'tool',
    level: 'info',
    operation: 'tool.execute',
    status: 'completed',
    actor_type: 'agent',
    actor_id: 'agent-1',
    created_at: '2026-03-12T12:00:00.000Z',
    payload: null,
    ...overrides,
  };
}

describe('log entry presentation', () => {
  it('shows system as the actor label for system-owned rows', () => {
    const entry = makeEntry({
      actor_type: 'system',
      actor_id: 'container-manager',
      actor_name: 'agirunner-runtime-1234',
    });

    expect(describeLogActorLabel(entry)).toBe('System');
    expect(describeLogActorDetail(entry)).toBe('-');
  });

  it('keeps tool activity labels human and omits raw invocation arguments', () => {
    const entry = makeEntry({
      payload: {
        tool_name: 'submit_handoff',
        input: {
          args: ['Reviewed the latest handoff for work item 1'],
        },
      },
      task_title: 'Orchestrate Content Assessment Blocked',
    });

    expect(describeLogActivityTitle(entry)).toBe('Submit Handoff');
    expect(describeLogActivityDetail(entry)).toBe('Tool call');
    expect(describeLogActivityDetail(entry)).not.toContain('Reviewed the latest handoff');
    expect(describeLogActivityDetail(entry)).not.toContain('Orchestrate Content Assessment Blocked');
  });

  it('falls back to dashes in compact views when workflow and stage are absent', () => {
    expect(describeWorkflowStageSummary(makeEntry())).toEqual({
      workflow: '-',
      stage: '-',
    });
  });
});
