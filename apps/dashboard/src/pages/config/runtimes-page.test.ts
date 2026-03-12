import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './runtimes-page.tsx'), 'utf8');
}

describe('runtimes page source', () => {
  it('reuses the structured runtime defaults surface instead of maintaining a second editor', () => {
    const source = readSource();
    expect(source).toContain("import { RuntimeDefaultsPage }");
    expect(source).toContain('<RuntimeDefaultsPage />');
    expect(source).not.toContain('/api/v1/config/runtime-defaults');
    expect(source).not.toContain("method: 'PATCH'");
  });
});
