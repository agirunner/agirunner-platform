import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './fleet-status-page.tsx'), 'utf8');
}

describe('fleet status pool split source', () => {
  it('renders worker-pool and playbook-pool sections from split fleet status data', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.fetchFleetStatus()');
    expect(source).toContain('dashboardApi.fetchFleetEvents({');
    expect(source).toContain('status.worker_pools');
    expect(source).toContain('status.by_playbook_pool');
    expect(source).toContain('Per-Playbook Pool Status');
  });
});
