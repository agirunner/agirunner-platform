import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('log viewer large-file guardrails', () => {
  it('keeps log-entry-presentation under 500 lines', () => {
    expect(countLines('./log-entry-presentation.ts')).toBeLessThanOrEqual(500);
  });

  it('keeps searchable-combobox under 500 lines', () => {
    expect(countLines('./ui/searchable-combobox.tsx')).toBeLessThanOrEqual(500);
  });
});
