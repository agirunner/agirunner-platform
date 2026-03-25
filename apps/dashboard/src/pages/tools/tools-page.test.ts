import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './tools-page.tsx',
    './tools-page.support.ts',
    '../../lib/dashboard-badge-palette.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('tools page source', () => {
  it('renders the tools page without creation or row-level action controls', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listToolTags()');
    expect(source).toContain('describeToolCategory');
    expect(source).toContain('Agentic runtime owned');
    expect(source).toContain('Task execution owned');
    expect(source).not.toContain('dashboardApi.createToolTag');
    expect(source).not.toContain('dashboardApi.updateToolTag');
    expect(source).not.toContain('dashboardApi.deleteToolTag');
    expect(source).not.toContain('Create Tool Tag');
    expect(source).not.toContain('Edit Tool Tag');
    expect(source).not.toContain('Delete Tool Tag');
  });

  it('displays tools in a table with categories', () => {
    const source = readSource();
    expect(source).toContain('TableHeader');
    expect(source).toContain('Category');
    expect(source).toContain('Access');
    expect(source).toContain('describeToolAccessScope');
    expect(source).toContain('Orchestrator only');
    expect(source).toContain('Specialist + orchestrator');
    expect(source).toContain('DASHBOARD_BADGE_BASE_CLASS_NAME');
    expect(source).not.toContain('Owner');
    expect(source).not.toContain('describeToolOwner');
    expect(source).not.toContain('Actions');
    expect(source).not.toContain(
      'Workflow-management surface. Specialists must not receive this tool.',
    );
    expect(source).not.toContain(
      'Enabled through the resolved model provider instead of a normal tool call.',
    );
  });
});
