import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './worker-list-page.tsx'), 'utf8');
}

describe('worker list two-pool source', () => {
  it('uses split fleet worker and pool status APIs for orchestrator vs specialist worker views', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.fetchFleetWorkers()');
    expect(source).toContain('dashboardApi.fetchFleetStatus()');
    expect(source).toContain('Orchestrator Workers');
    expect(source).toContain('Specialist Workers');
    expect(source).toContain('worker.pool_kind');
    expect(source).toContain('max-h-[80vh] max-w-xl overflow-y-auto');
    expect(source).toContain('className="w-full sm:w-auto"');
  });
});
