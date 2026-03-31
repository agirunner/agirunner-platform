import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('layout large-file guardrails', () => {
  it('keeps the layout shell family under 500 lines per file', () => {
    expect(countLines('./layout.tsx')).toBeLessThanOrEqual(500);
    expect(countLines('./layout.test.ts')).toBeLessThanOrEqual(500);
    expect(countLines('./layout-source.test.ts')).toBeLessThanOrEqual(500);
  });
});
