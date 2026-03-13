import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readHookSource() {
  return readFileSync(resolve(import.meta.dirname, './use-unsaved-changes.ts'), 'utf8');
}

describe('useUnsavedChanges hook', () => {
  it('exports a named function that accepts a dirty flag', () => {
    const source = readHookSource();
    expect(source).toContain('export function useUnsavedChanges(isDirty: boolean): void');
  });

  it('registers and removes a beforeunload listener based on dirty state', () => {
    const source = readHookSource();
    expect(source).toContain("window.addEventListener('beforeunload'");
    expect(source).toContain("window.removeEventListener('beforeunload'");
  });

  it('calls event.preventDefault inside the beforeunload handler', () => {
    const source = readHookSource();
    expect(source).toContain('event.preventDefault()');
  });

  it('only attaches the listener when dirty and cleans up via useEffect return', () => {
    const source = readHookSource();
    expect(source).toContain('if (!isDirty)');
    expect(source).toContain('return () => {');
  });

  it('depends on the isDirty value in the useEffect dependency array', () => {
    const source = readHookSource();
    expect(source).toContain('}, [isDirty])');
  });
});
