import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('operations page source', () => {
  it('reuses the shared runtime defaults editor and renders every operations group inline', () => {
    const source = readSource('./operations-page.tsx');
    expect(source).toContain('RuntimeDefaultsEditorPage');
    expect(source).toContain("title=\"Advanced platform settings\"");
    expect(source).toContain('OPERATIONS_INLINE_SECTION_COLUMNS');
    expect(source).toContain('inlineSectionColumns={OPERATIONS_INLINE_SECTION_COLUMNS}');
    expect(source).not.toContain('/api/v1/config/runtime-defaults');
  });
});
