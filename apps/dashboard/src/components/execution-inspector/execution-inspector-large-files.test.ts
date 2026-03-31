import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('execution inspector large-file guardrails', () => {
  it('keeps execution-inspector-support under 500 lines', () => {
    expect(countLines('./execution-inspector-support.ts')).toBeLessThanOrEqual(500);
  });
});
