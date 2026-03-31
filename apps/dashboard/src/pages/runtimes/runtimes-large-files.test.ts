import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('runtimes large-file guardrails', () => {
  it('keeps runtime-defaults-runtime-ops under 500 lines', () => {
    expect(countLines('./runtime-defaults-runtime-ops.ts')).toBeLessThanOrEqual(500);
  });

  it('keeps runtime-defaults.schema under 500 lines', () => {
    expect(countLines('./runtime-defaults.schema.ts')).toBeLessThanOrEqual(500);
  });

  it('keeps runtimes-build-history under 500 lines', () => {
    expect(countLines('./runtimes-build-history.tsx')).toBeLessThanOrEqual(500);
  });
});
