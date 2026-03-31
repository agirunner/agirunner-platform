import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countLines(path: string): number {
  return readFileSync(resolve(import.meta.dirname, path), 'utf8').split('\n').length;
}

describe('workspace settings large-file guardrails', () => {
  it('keeps the workspace settings family under 500 lines per file', () => {
    expect(countLines('./workspace-settings-tab.tsx')).toBeLessThanOrEqual(500);
    expect(countLines('./workspace-settings-tab.controls.tsx')).toBeLessThanOrEqual(500);
    expect(countLines('./workspace-settings-tab.test.tsx')).toBeLessThanOrEqual(500);
  });
});
