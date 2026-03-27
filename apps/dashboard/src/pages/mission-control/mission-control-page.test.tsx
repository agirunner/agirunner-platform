import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './mission-control-page.tsx',
    './mission-control-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('mission control page source', () => {
  it('frames mission control as one shell with mode, scope, saved view, and right-stack state', () => {
    const source = readSource();
    expect(source).toContain('DashboardPageHeader');
    expect(source).toContain('Mission Control');
    expect(source).toContain('Live');
    expect(source).toContain('Recent');
    expect(source).toContain('History');
    expect(source).toContain('Saved view');
    expect(source).toContain('Scope');
    expect(source).toContain('Attention');
    expect(source).toContain('Workflow');
    expect(source).toContain('Workflow canvas');
    expect(source).toContain('Selected workflow');
    expect(source).toContain('readMissionControlShellState');
    expect(source).toContain('buildMissionControlShellHref');
  });
});
