import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './use-cascading-entities.ts'), 'utf8');
}

describe('use cascading entities source', () => {
  it('keeps entity option caches warm instead of refetching on combobox search', () => {
    const source = readSource();

    expect(source).toContain('refetchInterval: 10_000');
    expect(source).toContain('refetchIntervalInBackground: true');
    expect(source).toContain('refetchOnWindowFocus: true');
    expect(source).not.toContain('refetchWorkspaces');
    expect(source).not.toContain('refetchWorkflows');
    expect(source).not.toContain('refetchTasks');
    expect(source).toContain('const searchWorkspaces = useCallback((_query: string) => {}, []);');
    expect(source).toContain('const searchWorkflows = useCallback((_query: string) => {}, []);');
    expect(source).toContain('const searchTasks = useCallback((_query: string) => {}, []);');
  });
});
