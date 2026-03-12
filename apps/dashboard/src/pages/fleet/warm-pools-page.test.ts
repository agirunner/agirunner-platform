import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './warm-pools-page.tsx'), 'utf8');
}

describe('warm pools two-pool source', () => {
  it('shows warm pool state and containers split by pool kind', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.fetchFleetStatus()');
    expect(source).toContain('pool_kind');
    expect(source).toContain('Orchestrator Warm Pool');
    expect(source).toContain('Specialist Warm Pool');
    expect(source).toContain('PoolBadge');
  });

  it('removes the fake pool size dialog and routes operators to real worker controls', () => {
    const source = readSource();
    expect(source).toContain('/config/runtimes');
    expect(source).toContain('Runtime Defaults');
    expect(source).toContain('Manage Workers');
    expect(source).toContain('worker desired state');
    expect(source).not.toContain('Configure Pool Size');
    expect(source).not.toContain('PoolSizeDialog');
  });
});
