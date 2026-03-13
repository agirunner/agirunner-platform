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
    expect(source).toContain('allGroupLabel="Sources"');
    expect(source).toContain('allGroupLabel="Statuses"');
  });

  it('serializes source and status filters into log query params', () => {
    const source = readSource('./hooks/use-log-filters.ts');
    expect(source).toContain("statuses: parseList(searchParams.get('status'))");
    expect(source).toContain("if (filters.statuses.length > 0) params.status = filters.statuses.join(',');");
    expect(source).toContain("sources: parseList(searchParams.get('source'))");
  });
});
