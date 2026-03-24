import { describe, expect, it } from 'vitest';

import type { LogEntry } from '../../lib/api.js';
import { groupByIteration } from './log-iteration-grouped-table.js';

function buildEntry(overrides: Partial<LogEntry>): LogEntry {
  return {
    id: 1,
    trace_id: 'trace-1',
    span_id: 'span-1',
    source: 'runtime',
    category: 'agent_loop',
    level: 'info',
    operation: 'agent.loop',
    status: 'completed',
    actor_type: 'worker',
    actor_id: 'worker-1',
    created_at: '2026-03-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupByIteration', () => {
  it('keeps the broader loop context inside each iteration bucket', () => {
    const grouped = groupByIteration([
      buildEntry({
        id: 1,
        category: 'agent_loop',
        operation: 'agent.think',
        payload: { iteration: 2 },
      }),
      buildEntry({
        id: 2,
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: { iteration: 2 },
      }),
      buildEntry({
        id: 3,
        category: 'tool',
        operation: 'tool.shell_exec',
        payload: { iteration: 2 },
      }),
    ]);

    expect(grouped.ungroupedCount).toBe(0);
    expect(grouped.buckets).toHaveLength(1);
    expect(grouped.buckets[0]?.entries.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it('leaves rows without iteration context ungrouped', () => {
    const grouped = groupByIteration([
      buildEntry({ id: 1, payload: { iteration: 1 } }),
      buildEntry({ id: 2, category: 'container', payload: { action: 'start' } }),
    ]);

    expect(grouped.buckets).toHaveLength(1);
    expect(grouped.ungroupedCount).toBe(1);
  });
});
