import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './tools-page.tsx'), 'utf8');
}

describe('tools page source', () => {
  it('surfaces CRUD actions for custom tool tags while protecting built-ins', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listToolTags()');
    expect(source).toContain('dashboardApi.createToolTag');
    expect(source).toContain('dashboardApi.updateToolTag');
    expect(source).toContain('dashboardApi.deleteToolTag');
    expect(source).toContain('describeToolCategory');
    expect(source).toContain('Create Tool Tag');
    expect(source).toContain('Edit Tool Tag');
    expect(source).toContain('Delete Tool Tag');
    expect(source).toContain('tool.is_built_in');
    expect(source).toContain('Built-in tools are read-only');
  });

  it('displays tools in a table with categories', () => {
    const source = readSource();
    expect(source).toContain('TableHeader');
    expect(source).toContain('Category');
    expect(source).toContain('Badge');
  });
});
