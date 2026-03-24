import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './containers-page.tsx'), 'utf8');
}

function readTableSource() {
  return [
    './containers-table.tsx',
    './containers-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
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
    expect(pageSource).toContain(
      'Live container inventory from the platform API, showing image, CPU, and memory of running and recently-active containers.',
    );
    expect(pageSource).toContain("SelectItem value=\"inactive\"");
    expect(pageSource).toContain("SelectItem value=\"running\">Active</SelectItem>");
    expect(pageSource).toContain('{runningCount} active • {inactiveCount} inactive this session');
    expect(pageSource).toContain('partitionSessionContainerRowsByFunction');
    expect(pageSource).toContain('Orchestrator agent');
    expect(pageSource).toContain('Specialists');
    expect(pageSource).toContain('Specialist agent');
    expect(pageSource).toContain('Specialist task execution');
    expect(pageSource).not.toContain('Orchestrator worker');
    expect(pageSource).not.toContain('Running now');
    expect(pageSource).not.toContain('Recently inactive');
    expect(pageSource).toContain('hasBaselineSnapshot: hasObservedSnapshot');
    expect(tableSource).toContain('<TableHead>Role</TableHead>');
    expect(tableSource).not.toContain('<TableHead>Backend</TableHead>');
    expect(tableSource).toContain('<TableHead>Stage</TableHead>');
    expect(tableSource).not.toContain('<TableHead>Container</TableHead>');
    expect(tableSource).not.toContain('<p className="text-xs text-muted-foreground">{row.name}</p>');
    expect(tableSource).toContain('const TABLE_COLUMN_CLASS_NAMES = [');
    expect(tableSource).toContain("const TABLE_COLUMN_CLASS_NAMES = [\n  'w-[7rem]',\n  'w-[12rem]',");
    expect(tableSource).toContain('<colgroup>');
    expect(tableSource).toContain('table-fixed');
    expect(tableSource).toContain('TABLE_COLUMN_CLASS_NAMES.map');
    expect(tableSource).toContain('resolveDiffCellTone');
    expect(tableSource).toContain('hasPendingField');
    expect(tableSource).toContain('hasRecentlyChangedField');
    expect(tableSource).not.toContain('No longer reported by the platform API');
    expect(tableSource).not.toContain('formatOperatorStatusLabel(row.activity_state ?? row.state)');
    expect(tableSource).toContain('renderContainerPresenceBadge');
    expect(tableSource).not.toContain('row.execution_backend');
    expect(tableSource).toContain("row.presence === 'inactive' ? 'Inactive' : 'Active'");
    expect(tableSource).toContain('sanitizeContainerContextLabel');
    expect(tableSource).toContain("value?.trim().toLowerCase() === 'specialist runtimes'");
    expect(tableSource).toContain("renderEntityLink(row.playbook_id, row.playbook_name, '/config/playbooks')");
    expect(tableSource).toContain("renderEntityLink(row.workflow_id, row.workflow_name, '/work/boards')");
    expect(tableSource).toContain("if (label?.trim() && !id) {");
    expect(tableSource).toContain('<span className="text-sm text-foreground">{label}</span>');
    expect(tableSource).not.toContain('Unassigned');
    expect(tableSource).toContain("return row.presence === 'inactive' ? 'bg-muted/6 italic hover:bg-muted/10' : 'hover:bg-background/60';");
    expect(tableSource).not.toContain('bg-accent/14');
    expect(supportSource).toContain('Orchestrator agent');
    expect(supportSource).not.toContain('Orchestrator worker');
    expect(supportSource).toContain('Specialist agent');
    expect(supportSource).toContain('Specialist task execution');
    expect(supportSource).toContain('visibleFieldsForNewRow');
    expect(supportSource).toContain('diffVisibleFields');
    expect(supportSource).toContain('rememberContainerContext');
    expect(supportSource).toContain('applyRememberedContext');
    expect(tableSource).not.toContain('Orchestrator Pool');
    expect(tableSource).not.toContain('Specialist Pool');
  });
});
