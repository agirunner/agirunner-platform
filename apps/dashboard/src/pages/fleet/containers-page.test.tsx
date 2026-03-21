import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './containers-page.tsx'), 'utf8');
}

function readTableSource() {
  return readFileSync(resolve(import.meta.dirname, './containers-table.tsx'), 'utf8');
}

function readSupportSource() {
  return readFileSync(resolve(import.meta.dirname, './containers-page.support.ts'), 'utf8');
}

describe('containers page source', () => {
  it('renders a realtime table instead of running and inactive card sections', () => {
    const pageSource = readSource();
    const tableSource = readTableSource();
    const supportSource = readSupportSource();
    expect(pageSource).toContain('dashboardApi.fetchLiveContainers()');
    expect(pageSource).toContain('ContainersTable');
    expect(pageSource).toContain("SelectItem value=\"inactive\"");
    expect(pageSource).not.toContain('Running now');
    expect(pageSource).not.toContain('Recently inactive');
    expect(tableSource).toContain('Task role');
    expect(supportSource).toContain('Orchestrator worker');
    expect(supportSource).toContain('Task execution');
    expect(tableSource).not.toContain('Orchestrator Pool');
    expect(tableSource).not.toContain('Specialist Pool');
  });
});
