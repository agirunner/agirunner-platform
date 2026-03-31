import { describe, expect, it, vi, beforeEach } from 'vitest';

import { OrchestratorConfigService } from '../../../src/services/orchestrator-config-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('OrchestratorConfigService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: OrchestratorConfigService;

  beforeEach(() => {
    pool = createMockPool();
    service = new OrchestratorConfigService(pool as never);
  });

  it('returns empty prompt when no config exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await service.get(TENANT_ID);

    expect(result.prompt).toBe('');
    expect(result.updatedAt).toBeDefined();
  });

  it('returns stored prompt when config exists', async () => {
    const now = new Date('2026-03-15T12:00:00Z');
    pool.query.mockResolvedValueOnce({
      rows: [{ prompt: 'You are the orchestrator.', updated_at: now }],
      rowCount: 1,
    });

    const result = await service.get(TENANT_ID);

    expect(result.prompt).toBe('You are the orchestrator.');
    expect(result.updatedAt).toBe('2026-03-15T12:00:00.000Z');
  });

  it('upserts prompt and returns updated config', async () => {
    const now = new Date('2026-03-15T12:00:00Z');
    pool.query.mockResolvedValueOnce({
      rows: [{ prompt: 'New prompt.', updated_at: now }],
      rowCount: 1,
    });

    const result = await service.upsert(TENANT_ID, 'New prompt.');

    expect(result.prompt).toBe('New prompt.');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      [TENANT_ID, 'New prompt.'],
    );
  });
});
