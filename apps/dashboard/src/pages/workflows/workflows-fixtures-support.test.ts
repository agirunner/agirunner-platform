import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(() => ''),
}));

vi.mock('node:child_process', () => ({
  execFileSync,
}));

import { appendWorkflowEvent } from '../../../tests/e2e/support/workflows-fixtures.js';

describe('workflows-fixtures appendWorkflowEvent', () => {
  beforeEach(() => {
    execFileSync.mockClear();
  });

  it('serializes the workflow event payload into the SQL insert', async () => {
    await expect(
      appendWorkflowEvent('11111111-1111-1111-1111-111111111111', 'workflow.created', {
        headline: 'Initial execution burst',
        summary: 'Fresh workflow work entered the live console.',
      }),
    ).resolves.toBeUndefined();

    expect(execFileSync).toHaveBeenCalledTimes(1);
    const firstCall = execFileSync.mock.calls[0] as unknown as [string, string[], { input: string }];
    expect(firstCall[0]).toBe('docker');
    expect(firstCall[2].input).toContain('"headline":"Initial execution burst"');
    expect(firstCall[2].input).toContain('"summary":"Fresh workflow work entered the live console."');
  });
});
