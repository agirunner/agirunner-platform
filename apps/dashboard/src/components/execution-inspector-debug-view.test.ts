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
    expect(source).toContain('Select an activity packet');
    expect(source).toContain('Operator packet');
    expect(source).toContain('Diagnostic payload');
    expect(source).toContain('Diagnostic handles');
    expect(source).toContain('Recorded activity');
    expect(source).toContain('Activity key');
    expect(source).toContain('Trace handle');
    expect(source).toContain('Span handle');
    expect(source).not.toContain('inspect raw payloads and identifiers');
  });

  it('keeps the delivery view focused on activity summaries instead of raw trace rows', () => {
    const source = readSource('execution-inspector-detail-view.tsx');

    expect(source).toContain('Loaded {props.loadedCount} operator activity packets');
    expect(source).toContain('Selected packet is pinned outside the current segment.');
    expect(source).toContain('describeExecutionHeadline(entry)');
    expect(source).toContain('describeExecutionNextAction(entry)');
    expect(source).toContain('dateTime={entry.created_at}');
    expect(source).toContain('title={recordedAt.absolute}');
    expect(source).toContain('recordedAt.relative');
    expect(source).toContain('diagnostic span {shortId(entry.span_id)}');
  });

  it('keeps the summary view focused on operator attention instead of database telemetry labels', () => {
    const source = readSource('execution-inspector-summary-view.tsx');

    expect(source).toContain('title="Activity coverage"');
    expect(source).toContain('title="Review posture"');
    expect(source).toContain('title="Reported spend"');
    expect(source).toContain('title="Activity families"');
    expect(source).toContain('describeActivityFamilyLabel');
    expect(source).toContain('Activity key · ${item.operation}');
    expect(source).toContain('Where the current slice is concentrating operator attention');
  });
});
