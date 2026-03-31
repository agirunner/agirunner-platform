import { describe, expect, it, vi } from 'vitest';

import {
  isRecoverableNotAppliedResult,
  runIdempotentMutation,
} from '../../../../../src/api/routes/orchestrator-control/shared.js';

describe('orchestrator control shared helpers', () => {
  it('detects recoverable not applied mutation results', () => {
    expect(
      isRecoverableNotAppliedResult({
        mutation_outcome: 'recoverable_not_applied',
      }),
    ).toBe(true);
    expect(
      isRecoverableNotAppliedResult({
        mutation_outcome: 'applied',
      }),
    ).toBe(false);
    expect(isRecoverableNotAppliedResult({})).toBe(false);
  });

  it('runs non-idempotent mutations inside a transaction when request_id is blank', async () => {
    const response = { ok: true };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
      release: vi.fn(),
    };
    const app = {
      pgPool: {
        connect: vi.fn(async () => client),
      },
    };

    const result = await runIdempotentMutation(
      app as never,
      {} as never,
      'tenant-1',
      'workflow-1',
      'tool_name',
      '   ',
      async (txClient) => {
        expect(txClient).toBe(client);
        return response;
      },
    );

    expect(result).toBe(response);
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
