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
    expect(source).toContain('Effective context strategy');
    expect(source).toContain('Tokens saved');
    expect(source).toContain('Checkpoint ref');
    expect(source).toContain('Memory writes');
    expect(source).not.toContain('inspect raw payloads and identifiers');
  });

  it('keeps the delivery view focused on activity summaries instead of raw trace rows', () => {
    const source = readSource('execution-inspector-detail-view.tsx');

    expect(source).toContain('of {props.loadedCount} operator activity packets');
    expect(source).toContain('Selected packet is pinned outside the current segment.');
    expect(source).toContain('describeExecutionHeadline(entry)');
    expect(source).toContain('describeExecutionNextAction(entry)');
    expect(source).toContain('dateTime={entry.created_at}');
    expect(source).toContain('title={recordedAt.absolute}');
    expect(source).toContain('recordedAt.relative');
    expect(source).toContain('span {shortId(entry.span_id)}');
  });

  it('MCL-003: bounds visible entries for mobile performance', () => {
    const source = readSource('execution-inspector-detail-view.tsx');

    expect(source).toContain('INITIAL_VISIBLE_COUNT');
    expect(source).toContain('VISIBLE_INCREMENT');
    expect(source).toContain('visibleEntries');
    expect(source).toContain('packets hidden for performance');
    expect(source).toContain('Show {Math.min(VISIBLE_INCREMENT');
  });

  it('MCL-007: contains overflow on delivery packet entries for mobile viewports', () => {
    const source = readSource('execution-inspector-detail-view.tsx');

    expect(source).toContain('overflow-hidden');
    expect(source).toContain('break-words');
    expect(source).toContain('break-all');
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

  it('MCL-001: contains overflow on trace detail sections for mobile viewports', () => {
    const source = readSource('execution-inspector-debug-view.tsx');

    expect(source).toContain('min-w-0 overflow-hidden');
    expect(source).toContain('overflow-x-auto');
    expect(source).toContain('break-words');
  });

  it('MCL-002: uses skeleton loading states instead of plain text in summary view', () => {
    const source = readSource('execution-inspector-summary-view.tsx');

    expect(source).toContain('Skeleton');
    expect(source).toContain('isLoading={props.isLoading}');
    expect(source).toContain('h-7 w-20');
    expect(source).toContain('h-4 w-32');
  });

  it('MCL-008: shows empty-state guidance when the activity slice has no records', () => {
    const source = readSource('execution-inspector-summary-view.tsx');

    expect(source).toContain('No activity in the current slice');
    expect(source).toContain('Widen the time window');
    expect(source).toContain('isEmptySlice');
    expect(source).toContain('Inbox');
  });
});
