import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './orchestrator-grants-page.tsx'), 'utf8');
}

describe('orchestrator grants page source', () => {
  it('uses shared workflow list data and structured permission controls', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listWorkflows()');
    expect(source).toContain('GRANT_PERMISSION_OPTIONS');
    expect(source).toContain('Workflow Scope');
    expect(source).not.toContain('Permissions (comma-separated)');
  });

  it('renders a mobile card view alongside the desktop table and scrollable dialogs', () => {
    const source = readSource();
    expect(source).toContain('GrantCards');
    expect(source).toContain('hidden lg:block');
    expect(source).toContain('max-h-[80vh] max-w-2xl overflow-y-auto');
  });
});
