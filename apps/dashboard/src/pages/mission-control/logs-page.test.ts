import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPage() {
  return readFileSync(resolve(import.meta.dirname, './logs-page.tsx'), 'utf8');
}

describe('execution inspector page source', () => {
  it('exposes summary, delivery, and debug views with v2 operator copy', () => {
    const source = readPage();
    expect(source).toContain('Execution Inspector');
    expect(source).toContain(
      'Summary, delivery, and debug views over work-item, stage, gate, runtime, and platform execution traces.',
    );
    expect(source).toContain('TabsTrigger value="summary"');
    expect(source).toContain('TabsTrigger value="detailed">Delivery</TabsTrigger>');
    expect(source).toContain('TabsTrigger value="debug"');
    expect(source).toContain('Failed to load delivery entries. Please refine filters and try again.');
  });

  it('uses the active log surfaces instead of the shared log viewer', () => {
    const source = readPage();
    expect(source).toContain('dashboardApi.queryLogs');
    expect(source).toContain('dashboardApi.getLogStats');
    expect(source).not.toContain('LogViewer');
  });

  it('drives inspector filters and selected entries from url search params', () => {
    const source = readPage();
    expect(source).toContain('useSearchParams');
    expect(source).toContain('readInspectorFilters(searchParams)');
    expect(source).toContain("next.set('log', String(logId))");
    expect(source).toContain("next.set('view', view)");
    expect(source).toContain('Permalink');
  });
});
