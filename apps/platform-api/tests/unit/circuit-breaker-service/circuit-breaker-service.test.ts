import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CircuitBreakerService } from '../../../src/services/circuit-breaker-service.js';

function createMockPool() {
  return {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  };
}

describe('CircuitBreakerService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: CircuitBreakerService;
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const workerId = '00000000-0000-0000-0000-000000000099';

  beforeEach(() => {
    pool = createMockPool();
    service = new CircuitBreakerService(pool as never);
  });

  describe('reportOutcome', () => {
    it('increasesScoreOnSuccess', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.9, circuit_breaker_state: 'closed', circuit_breaker_tripped_at: null }],
        })
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      const result = await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'success',
      });

      expect(result.qualityScore).toBeCloseTo(0.95);
      expect(result.circuitState).toBe('closed');
    });

    it('decreasesScoreOnFailure', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.8, circuit_breaker_state: 'closed', circuit_breaker_tripped_at: null }],
        })
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      const result = await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'failure',
      });

      expect(result.qualityScore).toBeCloseTo(0.7);
      expect(result.circuitState).toBe('closed');
    });

    it('tripsCircuitWhenScoreFallsBelowThreshold', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.35, circuit_breaker_state: 'closed', circuit_breaker_tripped_at: null }],
        })
        .mockResolvedValueOnce({ rows: [] }) // INSERT circuit_breaker_events
        .mockResolvedValueOnce({ rows: [] }); // UPDATE workers

      const result = await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'failure',
        reason: 'task timeout',
      });

      expect(result.qualityScore).toBeCloseTo(0.25);
      expect(result.circuitState).toBe('open');
    });

    it('redacts secret-bearing reason and metadata before persisting breaker events', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.35, circuit_breaker_state: 'closed', circuit_breaker_tripped_at: null }],
        })
        .mockResolvedValueOnce({ rows: [] }) // INSERT circuit_breaker_events
        .mockResolvedValueOnce({ rows: [] }); // UPDATE workers

      await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'failure',
        reason: 'secret:WORKER_FAILURE_REASON',
        metadata: {
          api_key: 'sk-live-secret',
          token_ref: 'secret:CIRCUIT_BREAKER_TOKEN',
          safe: 'visible',
        },
      });

      const [, params] = pool.query.mock.calls[1] as [string, unknown[]];
      expect(params[3]).toBe('redacted://circuit-breaker-secret');
      expect(params[6]).toBe(
        JSON.stringify({
          api_key: 'redacted://circuit-breaker-secret',
          token_ref: 'redacted://circuit-breaker-secret',
          safe: 'visible',
        }),
      );
    });

    it('recoversFromHalfOpenOnSuccess', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.4, circuit_breaker_state: 'half_open', circuit_breaker_tripped_at: new Date() }],
        })
        .mockResolvedValueOnce({ rows: [] }) // INSERT event
        .mockResolvedValueOnce({ rows: [] }); // UPDATE workers

      const result = await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'success',
      });

      expect(result.circuitState).toBe('closed');
    });

    it('reopensFromHalfOpenOnFailure', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.4, circuit_breaker_state: 'half_open', circuit_breaker_tripped_at: new Date() }],
        })
        .mockResolvedValueOnce({ rows: [] }) // INSERT event
        .mockResolvedValueOnce({ rows: [] }); // UPDATE workers

      const result = await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'error',
      });

      expect(result.circuitState).toBe('open');
    });

    it('throwsWhenWorkerNotFound', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.reportOutcome(tenantId, { workerId, outcome: 'success' }),
      ).rejects.toThrow('not found');
    });

    it('doesNotExceedQualityCeiling', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.98, circuit_breaker_state: 'closed', circuit_breaker_tripped_at: null }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'success',
      });

      expect(result.qualityScore).toBe(1.0);
    });

    it('doesNotGoBelowQualityFloor', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: workerId, quality_score: 0.05, circuit_breaker_state: 'open', circuit_breaker_tripped_at: new Date() }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.reportOutcome(tenantId, {
        workerId,
        outcome: 'failure',
      });

      expect(result.qualityScore).toBe(0.0);
    });
  });

  describe('getWorkerQuality', () => {
    it('returnsWorkerQualityData', async () => {
      const row = { id: workerId, quality_score: 0.85, circuit_breaker_state: 'closed', circuit_breaker_tripped_at: null };
      pool.query.mockResolvedValue({ rows: [row] });

      const result = await service.getWorkerQuality(tenantId, workerId);

      expect(result).toEqual(row);
    });

    it('returnsNullForMissingWorker', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await service.getWorkerQuality(tenantId, workerId);

      expect(result).toBeNull();
    });
  });

  describe('listEvents', () => {
    it('returnsEventsForWorker', async () => {
      const events = [
        {
          id: 'ev1',
          tenant_id: tenantId,
          worker_id: workerId,
          trigger_type: 'failure',
          reason: 'worker timed out',
          previous_state: 'closed',
          new_state: 'open',
          metadata: {},
          created_at: new Date('2026-03-13T12:00:00.000Z'),
        },
      ];
      pool.query.mockResolvedValue({ rows: events });

      const result = await service.listEvents(tenantId, workerId);

      expect(result).toEqual(events);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('circuit_breaker_events');
    });

    it('redacts secret-bearing reason and metadata on readback', async () => {
      pool.query.mockResolvedValue({
        rows: [
          {
            id: 'ev1',
            tenant_id: tenantId,
            worker_id: workerId,
            trigger_type: 'failure',
            reason: 'Bearer super-secret-token',
            previous_state: 'closed',
            new_state: 'open',
            metadata: {
              authorization: 'Bearer top-secret-token',
              secret_ref: 'secret:CIRCUIT_BREAKER_TOKEN',
              safe: 'visible',
            },
            created_at: new Date('2026-03-13T12:00:00.000Z'),
          },
        ],
      });

      const result = await service.listEvents(tenantId, workerId);

      expect(result).toEqual([
        expect.objectContaining({
          reason: 'redacted://circuit-breaker-secret',
          metadata: {
            authorization: 'redacted://circuit-breaker-secret',
            secret_ref: 'redacted://circuit-breaker-secret',
            safe: 'visible',
          },
        }),
      ]);
    });
  });

  describe('resetCircuitBreaker', () => {
    it('resetsScoreAndStateToDefaults', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: workerId, circuit_breaker_state: 'open' }] }) // SELECT
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [] }); // INSERT event

      await service.resetCircuitBreaker(tenantId, workerId);

      const updateSql = pool.query.mock.calls[1][0] as string;
      expect(updateSql).toContain("quality_score = 1.000");
      expect(updateSql).toContain("circuit_breaker_state = 'closed'");
    });

    it('throwsWhenWorkerNotFound', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.resetCircuitBreaker(tenantId, workerId)).rejects.toThrow('not found');
    });
  });
});
