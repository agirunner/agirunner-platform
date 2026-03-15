import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './tools-page.tsx'), 'utf8');
}

describe('tools page source', () => {
  it('is a read-only catalog with no create/edit/delete actions', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listToolTags()');
    expect(source).toContain('describeToolCategory');
    expect(source).not.toContain('createToolTag');
    expect(source).not.toContain('deleteToolTag');
    expect(source).not.toContain('updateToolTag');
    expect(source).not.toContain('Add Tool');
  });

  it('displays tools in a table with categories', () => {
    const source = readSource();
    expect(source).toContain('TableHeader');
    expect(source).toContain('Category');
    expect(source).toContain('Badge');
  });
});
