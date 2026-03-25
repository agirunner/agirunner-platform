import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(resolve(import.meta.dirname, './badge.tsx'), 'utf8');
}

describe('badge source', () => {
  it('uses filled high-contrast semantic variants for info and destructive badges', () => {
    const source = readSource();

    expect(source).toContain("info: 'border-sky-600 bg-sky-600 text-white");
    expect(source).toContain("destructive:");
    expect(source).toContain('dark:bg-rose-400');
    expect(source).toContain("secondary:");
    expect(source).toContain('dark:bg-zinc-300');
  });
});
