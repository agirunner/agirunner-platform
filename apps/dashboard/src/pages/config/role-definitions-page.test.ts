import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './role-definitions-page.tsx'), 'utf8');
}

describe('role definitions page source', () => {
  it('exposes a first-class create role flow instead of edit-only administration', () => {
    const source = readSource();
    expect(source).toContain('Create Role');
    expect(source).toContain('async function createRole');
  });

  it('keeps the role editor dialog scrollable and wide enough for large forms', () => {
    const source = readSource();
    expect(source).toContain('max-h-[85vh] max-w-4xl overflow-y-auto');
  });

  it('keeps unknown existing allowed tools editable alongside the standard catalog', () => {
    const source = readSource();
    expect(source).toContain('listAvailableTools');
    expect(source).toContain('Existing grants that are no longer in the standard catalog');
  });

  it('supports a first-class create role flow and uses the live create and replace routes', () => {
    const source = readSource();
    expect(source).toContain('Create Role');
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("method: 'PUT'");
    expect(source).not.toContain("method: 'PATCH'");
  });
});
