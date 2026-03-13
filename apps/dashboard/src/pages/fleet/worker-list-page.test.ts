import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './worker-list-page.tsx'), 'utf8');
}

describe('worker list two-pool source', () => {
  it('uses worker desired state as the canonical fleet configuration surface', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.fetchFleetWorkers()');
    expect(source).toContain('dashboardApi.fetchFleetStatus()');
    expect(source).toContain('dashboardApi.listLlmProviders()');
    expect(source).toContain('dashboardApi.listLlmModels()');
    expect(source).toContain('dashboardApi.deleteFleetWorker(workerId)');
    expect(source).toContain('WorkerDesiredStateDialog');
    expect(source).toContain('Runtime defaults');
    expect(source).toContain('Needs attention');
    expect(source).toContain('Disable worker desired state');
    expect(source).toContain('Desired state disabled.');
    expect(source).toContain('Restart requested');
    expect(source).toContain('Orchestrator workers');
    expect(source).toContain('Specialist workers');
  });
});
