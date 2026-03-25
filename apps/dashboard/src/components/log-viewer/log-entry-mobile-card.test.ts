import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './log-entry-mobile-card.tsx'), 'utf8');
}

describe('log entry mobile card source', () => {
  it('keeps only the level as a badge while rendering category and context as plain text fields', () => {
    const source = readSource();

    expect(source).toContain('Badge variant={levelVariant(entry.level)}');
    expect(source).toContain('isEscalationEntry');
    expect(source).not.toContain('CATEGORY_LABELS[entry.category] ?? entry.category}</Badge>');
    expect(source).not.toContain('{entry.operation}');
    expect(source).not.toContain('statusVariant(entry.status)');
    expect(source).not.toContain('summarizeLogContext(entry)');
    expect(source).not.toContain('readExecutionSignals(entry)');
    expect(source).toContain('Category');
    expect(source).toContain('Workflow');
    expect(source).toContain('Actor');
    expect(source).toContain('Status');
    expect(source).toContain('Duration');
    expect(source).not.toContain('\n              Tool\n');
    expect(source).not.toContain("'No workflow'");
    expect(source).toContain('const isEscalation = isEscalationEntry(entry);');
    expect(source).toContain('!isEscalation && entry.error?.message');
    expect(source).toContain('isEscalation && entry.error?.message');
  });
});
