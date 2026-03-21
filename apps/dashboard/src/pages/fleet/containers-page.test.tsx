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
    expect(pageSource).toContain('hasBaselineSnapshot: hasObservedSnapshot');
    expect(tableSource).toContain('<TableHead>Role</TableHead>');
    expect(tableSource).toContain('<TableHead>Stage</TableHead>');
    expect(tableSource).not.toContain('<TableHead>Container</TableHead>');
    expect(tableSource).toContain('resolveDiffCellTone');
    expect(tableSource).toContain('hasPendingField');
    expect(tableSource).toContain('hasRecentlyChangedField');
    expect(tableSource).toContain("value?.trim().toLowerCase() === 'specialist runtimes'");
    expect(tableSource).not.toContain('bg-accent/14');
    expect(supportSource).toContain('Orchestrator worker');
    expect(supportSource).toContain('Task execution');
    expect(supportSource).toContain('visibleFieldsForNewRow');
    expect(supportSource).toContain('diffVisibleFields');
    expect(tableSource).not.toContain('Orchestrator Pool');
    expect(tableSource).not.toContain('Specialist Pool');
  });
});
