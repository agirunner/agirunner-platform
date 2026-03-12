import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './agent-list-page.tsx'), 'utf8');
}

describe('agent list two-pool source', () => {
  it('shows orchestrator vs specialist pool state alongside agent filtering', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.fetchFleetStatus()');
    expect(source).toContain('Orchestrator Pool');
    expect(source).toContain('Specialist Pool');
    expect(source).toContain("SelectItem value=\"orchestrator\"");
    expect(source).toContain('readAgentPool');
  });
});
