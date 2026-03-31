import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('containers large-file guardrails', () => {
  it('keeps the containers support family under 500 lines per file', () => {
    expect(countLines('./containers-page.support.ts')).toBeLessThanOrEqual(500);
    expect(countLines('./containers-page.support.test.ts')).toBeLessThanOrEqual(500);
    expect(countLines('./containers-page.diff.ts')).toBeLessThanOrEqual(500);
  });
});
