import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-structured-entry-editor.tsx'), 'utf8');
}

describe('structured entry editor source', () => {
  it('keeps key, type, and remove controls on one compact row before the value field', () => {
    const source = readSource();

    expect(source).toContain("'grid gap-3 sm:flex sm:flex-nowrap sm:items-center'");
    expect(source).toContain('className="text-xs font-medium text-muted sm:w-8 sm:shrink-0"');
    expect(source).toContain('className="sm:min-w-0 sm:flex-1"');
    expect(source).toContain('className="w-full sm:w-40 sm:shrink-0"');
    expect(source).toContain('className="w-full whitespace-nowrap sm:ml-auto sm:w-auto sm:self-center"');
    expect(source).toContain('className="grid gap-3 sm:flex sm:items-start"');
    expect(source).toContain('className="pt-2 text-xs font-medium text-muted sm:w-10 sm:shrink-0"');
    expect(source).not.toContain('absolute top-3 right-3');
  });
});
