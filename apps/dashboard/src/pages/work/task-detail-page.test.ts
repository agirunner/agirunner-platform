import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './task-detail-page.tsx'), 'utf8');
}

describe('task detail page source', () => {
  it('surfaces specialist task context and v2 workflow scope fields', () => {
    const source = readSource();
    expect(source).toContain('describeTaskKind');
    expect(source).toContain('Orchestrator activation');
    expect(source).toContain('work_item_id');
    expect(source).toContain('activation_id');
    expect(source).toContain('Stage');
  });

  it('handles output review and escalation-aware operator actions', () => {
    const source = readSource();
    expect(source).toContain('approveTaskOutput');
    expect(source).toContain('escalated');
    expect(source).toContain('Resolve Escalation');
    expect(source).toContain('Execution Context');
    expect(source).toContain("status === 'running' || status === 'claimed'");
    expect(source).not.toContain("claimed: 'default'");
  });
});
