import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './containers-page.tsx'), 'utf8');
}

describe('containers page source', () => {
  it('shows live container inventory with running and recently inactive sections', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.fetchLiveContainers()');
    expect(source).toContain('Running now');
    expect(source).toContain('Recently inactive');
    expect(source).toContain('No longer reported by the platform API');
    expect(source).toContain("SelectItem value=\"inactive\"");
    expect(source).not.toContain('Orchestrator Pool');
    expect(source).not.toContain('Specialist Pool');
  });
});
