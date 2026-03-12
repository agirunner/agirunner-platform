import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './work/task-detail-page.tsx'), 'utf8');
}

describe('secondary task detail page source', () => {
  it('uses current V2 step-state handling and work-item-first operator flow', () => {
    const source = readSource();
    expect(source).toContain('normalizeTaskStatus');
    expect(source).toContain('usesWorkItemOperatorFlow');
    expect(source).toContain('in_progress');
    expect(source).toContain('escalated');
    expect(source).toContain('Open Work Item Flow');
  });

  it('uses current operator wording for the step action panel', () => {
    const source = readSource();
    expect(source).toContain('Approve Step');
    expect(source).toContain('Approve Output');
    expect(source).toContain('Retry Step');
    expect(source).toContain('Escalated specialist step');
  });
});
