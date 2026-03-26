import { describe, expect, it } from 'vitest';

import type { LogEntry } from '../../lib/api.js';
import {
  describeLogActivityDetail,
  describeLogActivityTitle,
  describeLogActorDetail,
  describeLogActorLabel,
  describeLogToolDisplay,
  describeWorkflowStageSummary,
  isEscalationEntry,
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

  it('shows orchestrator agent for orchestrator execution rows', () => {
    const entry = makeEntry({
      actor_type: 'agent',
      role: 'orchestrator',
      is_orchestrator_task: true,
      actor_name: 'Specialist Execution',
    });

    expect(describeLogActorLabel(entry)).toBe('Orchestrator agent');
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

    expect(describeLogActivityTitle(entry)).toBe('Submit handoff');
    expect(describeLogActivityDetail(entry)).toBe('Tool call');
    expect(describeLogToolDisplay(entry)).toBe('Submit handoff');
    expect(describeLogActivityDetail(entry)).not.toContain('Reviewed the latest handoff');
    expect(describeLogActivityDetail(entry)).not.toContain('Orchestrate Content Assessment Blocked');
  });

  it('surfaces tool names even when the row category is not tool', () => {
    const entry = makeEntry({
      category: 'agent_loop',
      operation: 'agent.observe',
      payload: {
        tool_name: 'read_latest_handoff',
        iteration: 2,
      },
    });

    expect(describeLogActivityTitle(entry)).toBe('Agent observe');
    expect(describeLogToolDisplay(entry)).toBe('Read latest handoff');
    expect(describeLogActivityDetail(entry)).toBe('Iteration 2 · Read latest handoff');
  });

  it('formats tool display with a compact argument summary when present', () => {
    const entry = makeEntry({
      payload: {
        tool_name: 'shell_exec',
        input: {
          command: 'npm test -- --runInBand src/components/log-viewer',
        },
      },
    });

    expect(describeLogToolDisplay(entry)).toBe('Shell exec(npm test -- --runInBand src/compone…)');
    expect(describeLogActivityDetail(entry)).toBe('Shell exec(npm test -- --runInBand src/compone…)');
  });

  it('surfaces tool intent from llm response tool-call payloads', () => {
    const entry = makeEntry({
      category: 'agent_loop',
      operation: 'agent.act',
      payload: {
        response_tool_calls: [
          {
            name: 'read_latest_handoff',
            input: {
              work_item_id: 'a3d68f2e-1111-2222-3333-444444444444',
            },
          },
        ],
      },
    });

    expect(describeLogToolDisplay(entry)).toContain('Read latest handoff(a3d68f2e-1111-2222-3333-');
    expect(describeLogActivityDetail(entry)).toContain('Read latest handoff(a3d68f2e-1111-2222-3333-');
  });

  it('surfaces tool intent from agent-loop phase payloads', () => {
    const entry = makeEntry({
      category: 'agent_loop',
      operation: 'agent.act',
      payload: {
        tool: 'read_latest_handoff',
        input: {
          work_item_id: 'a3d68f2e-1111-2222-3333-444444444444',
        },
      },
    });

    expect(describeLogToolDisplay(entry)).toContain('Read latest handoff(a3d68f2e-1111-2222-3333-');
    expect(describeLogActivityDetail(entry)).toContain('Read latest handoff(a3d68f2e-1111-2222-3333-');
  });

  it('parses object-shaped tool_calls payloads when present', () => {
    const entry = makeEntry({
      category: 'llm',
      operation: 'llm.chat_stream',
      payload: {
        tool_calls: [
          {
            function: {
              name: 'file_read',
              arguments: JSON.stringify({
                path: 'apps/dashboard/src/components/log-viewer/log-entry-row.tsx',
              }),
            },
          },
        ],
      },
    });

    expect(describeLogToolDisplay(entry)).toBe('File read(apps/dashboard/src/components/log-v…)');
    expect(describeLogActivityDetail(entry)).toBe('File read(apps/dashboard/src/components/log-v…)');
  });

  it('does not treat lifecycle phases like populate as tool usage', () => {
    const entry = makeEntry({
      category: 'runtime_lifecycle',
      operation: 'container.populate',
      payload: {
        command_or_path: 'populate',
        command: 'populate',
      },
    });

    expect(describeLogToolDisplay(entry)).toBeNull();
  });

  it('falls back to dashes in compact views when workflow and stage are absent', () => {
    expect(describeWorkflowStageSummary(makeEntry())).toEqual({
      workflow: '-',
      stage: '-',
    });
  });

  it('hides raw api route templates from compact activity labels', () => {
    const entry = makeEntry({
      category: 'api',
      operation: 'task.fail',
      payload: {
        method: 'POST',
        path: '/api/v1/tasks/:id/fail',
      },
    });

    expect(describeLogActivityTitle(entry)).toBe('Task fail');
    expect(describeLogActivityDetail(entry)).toBe('API request');
    expect(describeLogActivityDetail(entry)).not.toContain('/api/v1/tasks/:id/fail');
    expect(describeLogActivityDetail(entry)).not.toContain('POST');
  });

  it('drops api route param tokens from compact activity titles', () => {
    const entry = makeEntry({
      category: 'api',
      operation: 'api.get.assignments.:param',
      payload: {
        method: 'GET',
        path: '/api/v1/assignments/:id',
      },
    });

    expect(describeLogActivityTitle(entry)).toBe('Assignments');
    expect(describeLogActivityTitle(entry)).not.toContain(':param');
  });

  it('treats successful escalation entries as escalation rows for warning presentation', () => {
    const entry = makeEntry({
      category: 'task_lifecycle',
      level: 'warn',
      operation: 'task_lifecycle.task.escalated',
      payload: {
        event_type: 'task.escalated',
        to_state: 'escalated',
      },
    });

    expect(isEscalationEntry(entry)).toBe(true);
  });

  it('does not treat escalation depth failures as warning-only escalation rows', () => {
    const entry = makeEntry({
      category: 'task_lifecycle',
      level: 'error',
      operation: 'task_lifecycle.task.agentEscalated',
      payload: {
        event_type: 'task.escalation_depth_exceeded',
        to_state: 'failed',
      },
    });

    expect(isEscalationEntry(entry)).toBe(false);
  });
});
