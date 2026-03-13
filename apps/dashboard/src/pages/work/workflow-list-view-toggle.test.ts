import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './workflow-list-view-toggle.tsx'),
    'utf8',
  );
}

describe('workflow list view toggle source', () => {
  it('uses labeled responsive view controls instead of icon-only buttons', () => {
    const source = readSource();
    expect(source).toContain('Board layout mode');
    expect(source).toContain('List view');
    expect(source).toContain('Board view');
    expect(source).toContain('aria-pressed');
    expect(source).toContain('sm:grid-cols-2');
    expect(source).not.toContain('aria-label="List view"');
    expect(source).not.toContain('aria-label="Board view"');
  });
});
