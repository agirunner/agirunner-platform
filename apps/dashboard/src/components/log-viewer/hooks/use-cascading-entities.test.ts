import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './use-cascading-entities.ts'), 'utf8');
}

describe('useCascadingEntities source', () => {
  it('does not expose legacy template names in workflow subtitles', () => {
    const source = readSource();
    expect(source).toContain('subtitle: w.project?.name ?? undefined');
    expect(source).not.toContain('w.template?.name');
  });
});
