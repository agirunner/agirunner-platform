import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './runtime-defaults-page.tsx'), 'utf8');
}

describe('runtime defaults page source', () => {
  it('provides the canonical structured runtime configuration surface', () => {
    const source = readSource();
    expect(source).toContain("CardTitle className=\"text-2xl\">Runtimes</CardTitle>");
    expect(source).toContain('Agent container defaults');
    expect(source).toContain('Fleet limits');
    expect(source).not.toContain('JSON.parse');
  });

  it('uses the supported runtime-defaults API routes, including delete for clearing values', () => {
    const source = readSource();
    expect(source).toContain('/api/v1/config/runtime-defaults');
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("method: 'DELETE'");
    expect(source).not.toContain("method: 'PATCH'");
  });

  it('keeps runtime status and build visibility on the canonical page', () => {
    const source = readSource();
    expect(source).toContain('ActiveRuntimeImageCard');
    expect(source).toContain('BuildHistoryCard');
    expect(source).toContain('Clear a value and save to fall back to the platform default.');
  });
});
