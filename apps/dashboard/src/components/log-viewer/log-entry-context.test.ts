import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('routes workflow context links through workflow-detail permalinks with gate fallback', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './log-entry-detail.tsx'),
      'utf8',
    );

    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('gateStageName');
    expect(source).toContain('!entry.work_item_id && !entry.activation_id');
  });

  it('uses board and execution-step labels in active telemetry detail surfaces', () => {
    const detailSource = readFileSync(
      resolve(import.meta.dirname, './log-entry-detail.tsx'),
      'utf8',
    );
    const taskDetailSource = readFileSync(
      resolve(import.meta.dirname, './log-entry-detail-task.tsx'),
      'utf8',
    );
    const groupedTableSource = readFileSync(
      resolve(import.meta.dirname, './log-task-grouped-table.tsx'),
      'utf8',
    );

    expect(detailSource).toContain("task_lifecycle: 'Execution Step Lifecycle'");
    expect(detailSource).toContain('<DetailRow label="Board">');
    expect(detailSource).toContain('<DetailRow label="Step">');
    expect(detailSource).toContain('Diagnostic handles');
    expect(detailSource).toContain('Recorded payload');
    expect(taskDetailSource).toContain('Execution Step Lifecycle');
    expect(taskDetailSource).toContain("label: 'Board'");
    expect(taskDetailSource).toContain("label: 'Step Title'");
    expect(groupedTableSource).toContain('non-step');
  });
});
