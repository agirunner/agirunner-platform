import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './tools-page.tsx',
    './tools-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('tools page source', () => {
  it('keeps custom tool tags editable while removing the create modal entry point', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listToolTags()');
    expect(source).toContain('dashboardApi.updateToolTag');
    expect(source).toContain('dashboardApi.deleteToolTag');
    expect(source).toContain('describeToolCategory');
    expect(source).toContain('Edit Tool Tag');
    expect(source).toContain('Delete Tool Tag');
    expect(source).toContain('tool.is_built_in');
    expect(source).toContain('Built-in tools are read-only');
    expect(source).not.toContain('dashboardApi.createToolTag');
    expect(source).not.toContain('openCreateDialog');
    expect(source).not.toContain('Create Tool Tag');
  });

  it('displays tools in a table with categories', () => {
    const source = readSource();
    expect(source).toContain('TableHeader');
    expect(source).toContain('Category');
    expect(source).toContain('Owner');
    expect(source).toContain('describeToolOwner');
    expect(source).toContain("label: 'Runtime'");
    expect(source).toContain("label: 'Task sandbox'");
    expect(source).toContain('Badge');
  });
});
