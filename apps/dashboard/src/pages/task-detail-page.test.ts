import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './task-detail-page.tsx'), 'utf8');
}

describe('secondary task detail page source', () => {
  it('normalizes legacy task states to v2 operator language', () => {
    const source = readSource();
    expect(source).toContain('normalizeTaskState');
    expect(source).toContain('taskData?.state ??');
    expect(source).toContain('in_progress');
    expect(source).toContain('escalated');
  });

  it('uses current operator wording for the action panel', () => {
    const source = readSource();
    expect(source).toContain('Operator Actions');
    expect(source).not.toContain('Control-plane interventions');
  });
});
