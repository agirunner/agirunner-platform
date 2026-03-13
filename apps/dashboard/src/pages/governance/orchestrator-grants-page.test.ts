import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './orchestrator-grants-page.tsx',
    './orchestrator-grants-page.sections.tsx',
    './orchestrator-grants-page.dialog.tsx',
    './orchestrator-grants-page.table.tsx',
    './orchestrator-grants-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('orchestrator grants page source', () => {
  it('uses shared workflow data and shared select controls instead of native selects', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listWorkflows()');
    expect(source).toContain('GRANT_PERMISSION_OPTIONS');
    expect(source).toContain('Workflow scope');
    expect(source).toContain('SelectTrigger');
    expect(source).toContain('SelectItem');
    expect(source).not.toContain('<select');
    expect(source).not.toContain('Permissions (comma-separated)');
  });

  it('renders summary packets, responsive cards, and a scroll-safe dialog', () => {
    const source = readSource();
    expect(source).toContain('Grant coverage');
    expect(source).toContain('grid gap-3 lg:hidden');
    expect(source).toContain('hidden lg:block');
    expect(source).toContain('max-h-[80vh] max-w-3xl overflow-y-auto');
    expect(source).toContain('Revoke grant');
  });
});
