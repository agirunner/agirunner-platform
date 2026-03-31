import { describe, expect, it, vi } from 'vitest';

import { LogService } from '../../../src/logging/log-service.js';

function createMockPool() {
  return { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
}

describe('LogService batch insert errors', () => {
  it('adds an oversized-index hint to 54000 batch rejections', async () => {
    const pool = createMockPool();
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockRejectedValueOnce({
        code: '54000',
        message: 'index row requires 14352 bytes, maximum size is 8191',
      });

    const service = new LogService(pool as never);
    const result = await service.insertBatch([
      {
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime',
        category: 'tool',
        level: 'info',
        operation: 'tool.execute',
        status: 'completed',
        payload: { output: 'x'.repeat(32) },
      },
    ]);

    expect(result).toEqual({
      accepted: 0,
      rejected: 1,
      rejection_details: [
        {
          index: 0,
          trace_id: 'trace-1',
          operation: 'tool.execute',
          reason:
            'index row requires 14352 bytes, maximum size is 8191 (code=54000, hint=oversized index tuple; audit INCLUDE columns for wide text/json fields)',
        },
      ],
    });
  });
});
