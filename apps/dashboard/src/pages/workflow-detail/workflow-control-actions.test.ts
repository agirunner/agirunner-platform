import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-control-actions.tsx'), 'utf8');
}

describe('workflow control actions source', () => {
  it('adds an explicit confirmation step before pausing the workflow', () => {
    const source = readSource();
    expect(source).toContain('Pause workflow?');
    expect(source).toContain('Pausing freezes new routing and asks the current workflow work to stop cleanly.');
    expect(source).toContain('setIsPauseDialogOpen(true)');
    expect(source).toContain('Keep running');
    expect(source).toContain('Confirm pause');
    expect(source).toContain('pauseMutation.mutate()');
  });

  it('adds an explicit confirmation step before workflow cancellation', () => {
    const source = readSource();
    expect(source).toContain('Cancel workflow?');
    expect(source).toContain('Cancelling stops further orchestration and specialist work');
    expect(source).toContain('setIsCancelDialogOpen(true)');
    expect(source).toContain('Confirm cancel');
    expect(source).toContain('Keep running');
    expect(source).toContain('cancelMutation.mutate()');
  });
});
