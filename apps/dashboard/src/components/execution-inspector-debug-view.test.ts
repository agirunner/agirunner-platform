import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string): string {
  return readFileSync(resolve(import.meta.dirname, `./${fileName}`), 'utf8');
}

describe('execution inspector secondary surfaces', () => {
  it('keeps the debug view operator-readable while preserving diagnostic handles', () => {
    const source = readSource('execution-inspector-debug-view.tsx');

    expect(source).toContain('diagnostic handles behind the operator summary');
    expect(source).toContain('Recorded detail');
    expect(source).toContain('Diagnostic handles');
    expect(source).toContain('Trace handle');
    expect(source).toContain('Span handle');
    expect(source).not.toContain('inspect raw payloads and identifiers');
  });

  it('keeps the delivery view focused on activity summaries instead of raw trace rows', () => {
    const source = readSource('execution-inspector-detail-view.tsx');

    expect(source).toContain('Loaded {props.loadedCount} activity summaries');
    expect(source).toContain('Selected entry is pinned outside the current segment.');
    expect(source).toContain('activity span {shortId(entry.span_id)}');
  });

  it('keeps the summary view focused on operator attention instead of database telemetry labels', () => {
    const source = readSource('execution-inspector-summary-view.tsx');

    expect(source).toContain('title="Entries"');
    expect(source).toContain('title="Attention"');
    expect(source).toContain('title="Spend signal"');
    expect(source).toContain('Where the current slice is spending the most attention');
  });
});
