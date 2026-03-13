import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8');
}

describe('tools page source', () => {
  it('uses a summary-first, responsive catalog layout', () => {
    const source = [readSource('./tools-page.tsx'), readSource('./tools-page.support.ts')].join('\n');
    expect(source).toContain('Catalog size');
    expect(source).toContain('Category coverage');
    expect(source).toContain('Documentation posture');
    expect(source).toContain('space-y-4 lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
  });

  it('keeps the create dialog scroll-safe with save-readiness guidance', () => {
    const source = readSource('./tools-page.dialog.tsx');
    expect(source).toContain('max-h-[90vh] max-w-4xl overflow-hidden p-0');
    expect(source).toContain('Save readiness');
    expect(source).toContain('Resolve these issues before saving.');
    expect(source).toContain('Selected category');
  });

  it('validates ids and encourages descriptions before tool creation', () => {
    const source = [readSource('./tools-page.dialog.tsx'), readSource('./tools-page.support.ts')].join('\n');
    expect(source).toContain('Choose a unique tool ID.');
    expect(source).toContain('Use lowercase letters, numbers, and underscores only.');
    expect(source).toContain('Add a short description so operators understand when this tool should be granted.');
  });

  it('supports edit mode with read-only ID and mode-specific labels', () => {
    const source = readSource('./tools-page.dialog.tsx');
    expect(source).toContain("mode: 'edit'");
    expect(source).toContain("mode: 'create'");
    expect(source).toContain('Edit Tool');
    expect(source).toContain('Save Changes');
    expect(source).toContain('disabled');
  });

  it('provides a destructive delete confirmation dialog', () => {
    const source = readSource('./tools-page.delete-dialog.tsx');
    expect(source).toContain('Delete tool?');
    expect(source).toContain('irreversible');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('Delete Tool');
    expect(source).toContain('Cancel');
  });

  it('renders edit and delete actions for custom tools only', () => {
    const source = readSource('./tools-page.tsx');
    expect(source).toContain('is_built_in === false');
    expect(source).toContain('Pencil');
    expect(source).toContain('Trash2');
    expect(source).toContain('openEditDialog');
    expect(source).toContain('setDeletingTool');
  });
});
