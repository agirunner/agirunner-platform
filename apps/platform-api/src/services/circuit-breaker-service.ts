import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';

const QUALITY_DECAY = 0.05;
const QUALITY_FLOOR = 0.0;
const QUALITY_CEILING = 1.0;
const TRIP_THRESHOLD = 0.3;
const HALF_OPEN_COOLDOWN_MS = 5 * 60 * 1000;

type CircuitState = 'closed' | 'open' | 'half_open';

const reportOutcomeSchema = z.object({
  workerId: z.string().uuid(),
  outcome: z.enum(['success', 'failure', 'timeout', 'error']),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ReportOutcomeInput = z.infer<typeof reportOutcomeSchema>;

interface CircuitBreakerEventRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  worker_id: string;
  trigger_type: string;
  reason: string;
  previous_state: string;
  new_state: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface WorkerQualityRow {
  [key: string]: unknown;
  id: string;
  quality_score: number;
  circuit_breaker_state: string;
  circuit_breaker_tripped_at: Date | null;
}

export class CircuitBreakerService {
  constructor(private readonly pool: DatabasePool) {}

  async reportOutcome(tenantId: string, input: ReportOutcomeInput): Promise<{ qualityScore: number; circuitState: CircuitState }> {
    const validated = reportOutcomeSchema.parse(input);

    const workerResult = await this.pool.query<WorkerQualityRow>(
      'SELECT id, quality_score, circuit_breaker_state, circuit_breaker_tripped_at FROM workers WHERE tenant_id = $1 AND id = $2',
      [tenantId, validated.workerId],
    );

    if (workerResult.rows.length === 0) {
      throw new Error(`Worker ${validated.workerId} not found`);
    }

    const worker = workerResult.rows[0];
    let score = Number(worker.quality_score);
    let state = worker.circuit_breaker_state as CircuitState;

    if (validated.outcome === 'success') {
      score = Math.min(QUALITY_CEILING, score + QUALITY_DECAY);
    } else {
      score = Math.max(QUALITY_FLOOR, score - QUALITY_DECAY * 2);
    }

    const previousState = state;

    if (score <= TRIP_THRESHOLD && state === 'closed') {
      state = 'open';
      await this.recordEvent(tenantId, validated.workerId, validated.outcome, validated.reason ?? 'quality below threshold', previousState, state, validated.metadata ?? {});
    } else if (state === 'open') {
      const trippedAt = worker.circuit_breaker_tripped_at;
      if (trippedAt && Date.now() - new Date(trippedAt).getTime() >= HALF_OPEN_COOLDOWN_MS) {
        state = 'half_open';
        await this.recordEvent(tenantId, validated.workerId, 'cooldown_elapsed', 'entering half_open after cooldown', previousState, state, {});
      }
    } else if (state === 'half_open') {
      if (validated.outcome === 'success') {
        state = 'closed';
        await this.recordEvent(tenantId, validated.workerId, 'success', 'recovered in half_open', previousState, state, {});
      } else {
        state = 'open';
        await this.recordEvent(tenantId, validated.workerId, validated.outcome, validated.reason ?? 'failed in half_open', previousState, state, validated.metadata ?? {});
      }
    }

    await this.pool.query(
      `UPDATE workers
       SET quality_score = $3,
           circuit_breaker_state = $4,
           circuit_breaker_tripped_at = CASE WHEN $4 = 'open' AND circuit_breaker_state <> 'open' THEN NOW() ELSE circuit_breaker_tripped_at END
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, validated.workerId, score, state],
    );

    return { qualityScore: score, circuitState: state };
  }

  async getWorkerQuality(tenantId: string, workerId: string): Promise<WorkerQualityRow | null> {
    const result = await this.pool.query<WorkerQualityRow>(
      'SELECT id, quality_score, circuit_breaker_state, circuit_breaker_tripped_at FROM workers WHERE tenant_id = $1 AND id = $2',
      [tenantId, workerId],
    );
    return result.rows[0] ?? null;
  }

  async listEvents(tenantId: string, workerId: string, limit: number = 50): Promise<CircuitBreakerEventRow[]> {
    const result = await this.pool.query<CircuitBreakerEventRow>(
      'SELECT * FROM circuit_breaker_events WHERE tenant_id = $1 AND worker_id = $2 ORDER BY created_at DESC LIMIT $3',
      [tenantId, workerId, limit],
    );
    return result.rows;
  }

  async resetCircuitBreaker(tenantId: string, workerId: string): Promise<void> {
    const workerResult = await this.pool.query<WorkerQualityRow>(
      'SELECT id, circuit_breaker_state FROM workers WHERE tenant_id = $1 AND id = $2',
      [tenantId, workerId],
    );
    if (workerResult.rows.length === 0) {
      throw new Error(`Worker ${workerId} not found`);
    }

    const previousState = workerResult.rows[0].circuit_breaker_state;
    await this.pool.query(
      `UPDATE workers SET quality_score = 1.000, circuit_breaker_state = 'closed', circuit_breaker_tripped_at = NULL WHERE tenant_id = $1 AND id = $2`,
      [tenantId, workerId],
    );

    await this.recordEvent(tenantId, workerId, 'manual_reset', 'circuit breaker manually reset', previousState, 'closed', {});
  }

  private async recordEvent(
    tenantId: string,
    workerId: string,
    triggerType: string,
    reason: string,
    previousState: string,
    newState: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO circuit_breaker_events (tenant_id, worker_id, trigger_type, reason, previous_state, new_state, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, workerId, triggerType, reason, previousState, newState, JSON.stringify(metadata)],
    );
  }
}
