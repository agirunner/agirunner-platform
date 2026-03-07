import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';

const recordMeteringSchema = z.object({
  taskId: z.string().uuid(),
  workflowId: z.string().uuid().optional(),
  workerId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  tokensInput: z.number().int().min(0).default(0),
  tokensOutput: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  wallTimeMs: z.number().int().min(0).default(0),
  cpuMs: z.number().int().min(0).optional(),
  memoryPeakBytes: z.number().int().min(0).optional(),
  networkBytes: z.number().int().min(0).optional(),
});

export type RecordMeteringInput = z.infer<typeof recordMeteringSchema>;

interface MeteringRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  task_id: string;
  workflow_id: string | null;
  worker_id: string | null;
  agent_id: string | null;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  wall_time_ms: number;
  cpu_ms: number | null;
  memory_peak_bytes: number | null;
  network_bytes: number | null;
  created_at: Date;
}

interface MeteringSummary {
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostUsd: number;
  totalWallTimeMs: number;
  eventCount: number;
}

export class MeteringService {
  constructor(private readonly pool: DatabasePool) {}

  async record(tenantId: string, input: RecordMeteringInput): Promise<MeteringRow> {
    const validated = recordMeteringSchema.parse(input);

    const result = await this.pool.query<MeteringRow>(
      `INSERT INTO metering_events (
        tenant_id, task_id, workflow_id, worker_id, agent_id,
        tokens_input, tokens_output, cost_usd, wall_time_ms,
        cpu_ms, memory_peak_bytes, network_bytes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        tenantId,
        validated.taskId,
        validated.workflowId ?? null,
        validated.workerId ?? null,
        validated.agentId ?? null,
        validated.tokensInput,
        validated.tokensOutput,
        validated.costUsd,
        validated.wallTimeMs,
        validated.cpuMs ?? null,
        validated.memoryPeakBytes ?? null,
        validated.networkBytes ?? null,
      ],
    );
    return result.rows[0];
  }

  async query(
    tenantId: string,
    filters: { from?: string; to?: string; workflowId?: string; workerId?: string },
  ): Promise<MeteringRow[]> {
    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let paramIndex = 2;

    if (filters.from) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(filters.to);
    }
    if (filters.workflowId) {
      conditions.push(`workflow_id = $${paramIndex++}`);
      values.push(filters.workflowId);
    }
    if (filters.workerId) {
      conditions.push(`worker_id = $${paramIndex++}`);
      values.push(filters.workerId);
    }

    const result = await this.pool.query<MeteringRow>(
      `SELECT * FROM metering_events WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 1000`,
      values,
    );
    return result.rows;
  }

  async summarize(
    tenantId: string,
    filters: { from?: string; to?: string; workflowId?: string },
  ): Promise<MeteringSummary> {
    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let paramIndex = 2;

    if (filters.from) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(filters.to);
    }
    if (filters.workflowId) {
      conditions.push(`workflow_id = $${paramIndex++}`);
      values.push(filters.workflowId);
    }

    const result = await this.pool.query<{
      total_tokens_input: string;
      total_tokens_output: string;
      total_cost_usd: string;
      total_wall_time_ms: string;
      event_count: string;
    }>(
      `SELECT
        COALESCE(SUM(tokens_input), 0) AS total_tokens_input,
        COALESCE(SUM(tokens_output), 0) AS total_tokens_output,
        COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
        COALESCE(SUM(wall_time_ms), 0) AS total_wall_time_ms,
        COUNT(*) AS event_count
      FROM metering_events WHERE ${conditions.join(' AND ')}`,
      values,
    );

    const row = result.rows[0];
    return {
      totalTokensInput: Number(row.total_tokens_input),
      totalTokensOutput: Number(row.total_tokens_output),
      totalCostUsd: Number(row.total_cost_usd),
      totalWallTimeMs: Number(row.total_wall_time_ms),
      eventCount: Number(row.event_count),
    };
  }
}
