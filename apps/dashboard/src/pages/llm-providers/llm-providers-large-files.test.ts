import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('llm providers large-file guardrails', () => {
  it('keeps llm-providers-page under 500 lines', () => {
    expect(countLines('./llm-providers-page.tsx')).toBeLessThanOrEqual(500);
  });
});
