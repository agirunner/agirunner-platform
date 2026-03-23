import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './system-metrics-page.tsx'), 'utf8');
}

describe('system metrics page source', () => {
  it('uses structured cards and a scrollable metrics surface', () => {
    const source = readSource();
    expect(source).toContain('CardTitle');
    expect(source).toContain('Metric Families');
    expect(source).toContain('overflow-x-auto');
    expect(source).not.toContain('className="card"');
    expect(source).not.toContain('<pre>{query.data}</pre>');
  });

  it('provides real filtering and refresh controls for metrics output', () => {
    const source = readSource();
    expect(source).toContain('refetch');
    expect(source).toContain('Filter metrics');
    expect(source).toContain('matchingLines');
  });

  it('clarifies that this page starts with the platform feed and hints at runtime continuity metrics', () => {
    const source = readSource();
    expect(source).toContain('platform metrics feed');
    expect(source).toContain('agirunner_runtime_context_warnings_total');
    expect(source).toContain('agirunner_runtime_loop_compactions_total');
  });
});
