import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './log-entry-row.tsx'), 'utf8');
}

describe('log entry row source', () => {
  it('uses real columns instead of a scope badge cluster, while keeping only the level as a badge', () => {
    const source = readSource();

    expect(source).toContain("import { formatLogRelativeTime } from './log-time.js';");
    expect(source).toContain("from './log-entry-presentation.js';");
    expect(source).toContain('title={formatTimestamp(entry.created_at)}');
    expect(source).toContain('{formatLogRelativeTime(entry.created_at)}');
    expect(source).toContain('>Time</th>');
    expect(source).toContain('>Level</th>');
    expect(source).toContain('>Category</th>');
    expect(source).toContain('>Workflow / Stage</th>');
    expect(source).toContain('>Actor</th>');
    expect(source).toContain('>Activity</th>');
    expect(source).toContain('>Duration</th>');
    expect(source).toContain("text-[11px] uppercase tracking-wider text-foreground/70");
    expect(source).toContain('describeLogActorLabel');
    expect(source).toContain('describeWorkflowStageSummary');
    expect(source).toContain('describeLogActorDetail');
    expect(source).not.toContain('formatStatusLabel');
    expect(source).not.toContain('describeExecutionHeadline(entry)');
    expect(source).toContain('describeLogActivityDetail');
    expect(source).not.toContain('font-mono text-[11px] text-muted-foreground/80');
    expect(source).not.toContain("bg-red-500/5");
    expect(source).not.toContain('bg-red-50 text-red-700');
    expect(source).toContain("variant={LEVEL_BADGE_VARIANT[entry.level] ?? 'info'}");
    expect(source).toContain("error: 'destructive'");
    expect(source).toContain("warn: 'warning'");
    expect(source).toContain('bg-rose-100');
    expect(source).toContain('dark:bg-rose-500/12');
    expect(source).not.toContain('CATEGORY_STYLES');
    expect(source).not.toContain('>Status</th>');
    expect(source).not.toContain('>Scope</th>');
    expect(source).not.toContain('buildScopeItems(');
    expect(source).not.toContain('function unused()');
    expect(source).not.toContain('>Tool</th>');
  });
});
