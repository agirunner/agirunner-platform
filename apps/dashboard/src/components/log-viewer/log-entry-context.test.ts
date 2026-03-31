import { describe, expect, it } from 'vitest';

import type { LogEntry } from '../../lib/api.js';
import { getCanonicalStageName, getCanonicalStageNames } from './log-entry-context.js';

function createEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 1,
    trace_id: 'trace-1',
    span_id: 'span-1',
    source: 'runtime',
    category: 'llm',
    level: 'info',
    operation: 'llm.chat',
    status: 'completed',
    actor_type: 'worker',
    actor_id: 'worker-1',
    created_at: '2026-03-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('log entry context', () => {
  it('prefersCanonicalStageNameOverLegacyPayloadPhase', () => {
    const entry = createEntry({
      stage_name: 'implementation',
      payload: {
        stage_name: 'review',
        phase: 'legacy-phase',
      },
    });

    expect(getCanonicalStageName(entry)).toBe('implementation');
  });

  it('readsStageNameFromPayloadWhenEntryContextIsMissing', () => {
    const entry = createEntry({
      payload: {
        stage_name: 'triage',
        phase: 'legacy-phase',
      },
    });

    expect(getCanonicalStageName(entry)).toBe('triage');
  });

  it('collectsUniqueCanonicalStagesOnly', () => {
    const entries = [
      createEntry({ stage_name: 'implementation' }),
      createEntry({ id: 2, payload: { stage_name: 'review', phase: 'act' } }),
      createEntry({ id: 3, payload: { phase: 'observe' } }),
      createEntry({ id: 4, stage_name: 'implementation' }),
    ];

    expect(getCanonicalStageNames(entries)).toEqual(['implementation', 'review']);
  });
});
