import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './role-definitions-page.tsx'), 'utf8');
}

function readCombinedSource() {
  return [
    readSource(),
    readFileSync(resolve(import.meta.dirname, './role-definitions-page.parts.tsx'), 'utf8'),
    readFileSync(resolve(import.meta.dirname, './role-definitions-page.support.ts'), 'utf8'),
  ].join('\n');
}

describe('role definitions page source', () => {
  it('exposes a first-class create role flow instead of edit-only administration', () => {
    const source = readSource();
    expect(source).toContain('Create Role');
    expect(source).toContain('function saveRole');
    expect(source).toContain("method: roleId ? 'PUT' : 'POST'");
  });

  it('keeps the role editor dialog scrollable and wide enough for large forms', () => {
    const source = readSource();
    expect(source).toContain("import { MetricCard, RoleDialog, RoleRow } from './role-definitions-page.parts.js'");
    const partsSource = readFileSync(resolve(import.meta.dirname, './role-definitions-page.parts.tsx'), 'utf8');
    expect(partsSource).toContain('max-h-[85vh] max-w-5xl overflow-y-auto');
  });

  it('keeps unknown existing allowed tools editable alongside the standard catalog', () => {
    const source = readCombinedSource();
    expect(source).toContain('listAvailableTools');
    expect(source).toContain('Existing grants that are no longer in the standard catalog');
  });

  it('supports a first-class create role flow and uses the live create and replace routes', () => {
    const source = readCombinedSource();
    expect(source).toContain('Create Role');
    expect(source).toContain("method: roleId ? 'PUT' : 'POST'");
    expect(source).not.toContain("method: 'PATCH'");
  });
});
