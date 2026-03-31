import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('layout large-file guardrails', () => {
  it('keeps layout.tsx under 500 lines', () => {
    expect(countLines('./layout.tsx')).toBeLessThanOrEqual(500);
  });
});
