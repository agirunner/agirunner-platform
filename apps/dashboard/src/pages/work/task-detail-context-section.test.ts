import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './task-detail-context-section.tsx'), 'utf8');
}

describe('task detail context section source', () => {
  it('uses summary-first packets with explicit raw-data disclosure', () => {
    const source = readSource();
    expect(source).toContain('Execution evidence');
    expect(source).toContain('Clarification history');
    expect(source).toContain('View clarification answers');
    expect(source).toContain('View escalation response');
    expect(source).toContain('View runtime context');
    expect(source).toContain('ProgressiveDataBlock');
  });

  it('keeps context facts readable instead of dumping structured blocks first', () => {
    const source = readSource();
    expect(source).toContain('Current answers');
    expect(source).toContain('Recorded human guidance');
    expect(source).toContain('Execution highlights');
    expect(source).toContain('FactGrid');
    expect(source).toContain('rounded-xl border border-border/70 bg-card/60 p-4');
  });
});
