import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('playbook authoring large-file guardrails', () => {
  it('keeps the public form-sections module under 500 lines', () => {
    expect(countLines('./playbook-authoring-form-sections.tsx')).toBeLessThanOrEqual(500);
  });

  it('keeps the public support module under 500 lines', () => {
    expect(countLines('./playbook-authoring-support.ts')).toBeLessThanOrEqual(500);
  });

  it('keeps the public structured-controls module under 500 lines', () => {
    expect(countLines('./playbook-authoring-structured-controls.tsx')).toBeLessThanOrEqual(500);
  });
});
