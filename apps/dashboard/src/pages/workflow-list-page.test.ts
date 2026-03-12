import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './work/workflow-list-page.tsx'), 'utf8');
}

describe('workflow list page source', () => {
  it('uses board-first posture labels and operator summaries', () => {
    const source = readSource();
    expect(source).toContain('Delivery Boards');
    expect(source).toContain('Board Posture');
    expect(source).toContain('describeOperatorSignal');
    expect(source).toContain('describeWorkItemSummary');
    expect(source).toContain('describeGateSummary');
    expect(source).toContain('No runs match the current filters.');
  });

  it('uses current V2 launch and saved-view controls', () => {
    const source = readSource();
    expect(source).toContain('Launch Playbook');
    expect(source).toContain('SavedViews');
    expect(source).toContain('statusFilter');
    expect(source).toContain('typeFilter');
  });
});
