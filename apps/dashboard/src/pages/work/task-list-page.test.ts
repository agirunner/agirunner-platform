import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './task-list-page.tsx'), 'utf8');
}

describe('task list page source', () => {
  it('frames the list as specialist execution instead of a generic task table', () => {
    const source = readSource();
    expect(source).toContain('Specialist Tasks');
    expect(source).toContain('Operator view of specialist execution');
    expect(source).toContain('describeTaskKind');
    expect(source).toContain('Orchestrator activation');
  });

  it('surfaces v2 workflow scope and operator review states', () => {
    const source = readSource();
    expect(source).toContain('stage_name');
    expect(source).toContain('work_item_id');
    expect(source).toContain('activation_id');
    expect(source).toContain('output_pending_review');
    expect(source).toContain('escalated');
    expect(source).toContain("status === 'running' || status === 'claimed'");
    expect(source).not.toContain("| 'claimed'");
  });
});
