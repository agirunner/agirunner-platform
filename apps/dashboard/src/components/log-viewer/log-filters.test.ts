import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string): string {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('log filters source', () => {
  it('exposes actor, source, and status controls in the raw logs filter bar', () => {
    const source = readSource('./log-filters.tsx');
    expect(source).toContain('useLogActors(scopedFilters)');
    expect(source).toContain("placeholder={\n            filters.actors.length > 0");
    expect(source).toContain('allGroupLabel="Actors"');
    expect(source).toContain('allGroupLabel="Execution backend"');
    expect(source).toContain('allGroupLabel="Tool owner"');
    expect(source).toContain('allGroupLabel="Sources"');
    expect(source).toContain('allGroupLabel="Statuses"');
  });

  it('debounces text filter inputs to avoid per-keystroke refetches', () => {
    const source = readSource('./log-filters.tsx');

    // Search is debounced
    expect(source).toContain('searchDraft');
    expect(source).toContain('useDebounced(searchDraft');

    // Workflow context inputs are debounced
    expect(source).toContain('workItemDraft');
    expect(source).toContain('stageDraft');
    expect(source).toContain('activationDraft');
    expect(source).toContain('useDebounced(workItemDraft');
    expect(source).toContain('useDebounced(stageDraft');
    expect(source).toContain('useDebounced(activationDraft');

    // Combobox/select controls remain immediate
    expect(source).toContain('onChange={toggleRole}');
    expect(source).toContain('onChange={toggleActor}');
    expect(source).toContain('onChange={toggleOperation}');
  });

  it('serializes source and status filters into log query params', () => {
    const source = readSource('./hooks/use-log-filters.ts');
    expect(source).toContain("statuses: parseList(searchParams.get('status'))");
    expect(source).toContain("if (filters.statuses.length > 0) params.status = filters.statuses.join(',');");
    expect(source).toContain("sources: parseList(searchParams.get('source'))");
    expect(source).toContain("executionBackend: parseList(searchParams.get('execution_backend'))");
    expect(source).toContain("toolOwner: parseList(searchParams.get('tool_owner'))");
    expect(source).toContain('params.execution_backend = filters.executionBackend.join');
    expect(source).toContain('params.tool_owner = filters.toolOwner.join');
  });
});
