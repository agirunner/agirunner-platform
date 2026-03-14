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
  today: number;
  this_week: number;
  this_month: number;
  budget_total: number;
  budget_remaining: number;
  by_workflow: Array<{ name: string; cost: number }>;
  by_model: Array<{ model: string; cost: number }>;
  daily_trend: Array<{ date: string; cost: number }>;
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
    const { whereClause, values, workflowBudgetClause } = this.buildSummaryScope(tenantId, filters);

    const result = await this.pool.query<{
      total_tokens_input: string;
      total_tokens_output: string;
      total_cost_usd: string;
      total_wall_time_ms: string;
      event_count: string;
      today_cost: string;
      week_cost: string;
      month_cost: string;
    }>(
      `SELECT
        COALESCE(SUM(tokens_input), 0) AS total_tokens_input,
        COALESCE(SUM(tokens_output), 0) AS total_tokens_output,
        COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
        COALESCE(SUM(wall_time_ms), 0) AS total_wall_time_ms,
        COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today_cost,
        COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'), 0) AS week_cost,
        COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0) AS month_cost,
        COUNT(*) AS event_count
      FROM metering_events WHERE ${whereClause}`,
      values,
    );

    const workflowBreakdown = await this.pool.query<{
      name: string;
      cost: string;
    }>(
      `SELECT
         COALESCE(w.name, me.workflow_id::text, 'Unassigned board') AS name,
         COALESCE(SUM(me.cost_usd), 0) AS cost
       FROM metering_events me
       LEFT JOIN workflows w
         ON w.id = me.workflow_id
        AND w.tenant_id = me.tenant_id
       WHERE ${whereClause.replaceAll('created_at', 'me.created_at').replaceAll('workflow_id', 'me.workflow_id').replaceAll('tenant_id', 'me.tenant_id')}
       GROUP BY COALESCE(w.name, me.workflow_id::text, 'Unassigned board')
       ORDER BY SUM(me.cost_usd) DESC
       LIMIT 5`,
      values,
    );

    const dailyTrend = await this.pool.query<{
      day: string;
      cost: string;
    }>(
      `SELECT
         to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
         COALESCE(SUM(cost_usd), 0) AS cost
       FROM metering_events
       WHERE ${whereClause}
       GROUP BY date_trunc('day', created_at)
       ORDER BY date_trunc('day', created_at) ASC
       LIMIT 14`,
      values,
    );

    const budgetResult = await this.pool.query<{ budget_total: string }>(
      `SELECT COALESCE(SUM(cost_cap_usd), 0) AS budget_total
       FROM workflows
       WHERE tenant_id = $1
         AND archived_at IS NULL
         ${workflowBudgetClause}`,
      filters.workflowId ? [tenantId, filters.workflowId] : [tenantId],
    );

    const row = result.rows[0];
    const totalCostUsd = Number(row.total_cost_usd);
    const budgetTotal = Number(budgetResult.rows[0]?.budget_total ?? 0);
    return {
      today: Number(row.today_cost),
      this_week: Number(row.week_cost),
      this_month: Number(row.month_cost),
      budget_total: budgetTotal,
      budget_remaining: Math.max(budgetTotal - totalCostUsd, 0),
      by_workflow: workflowBreakdown.rows.map((entry) => ({
        name: entry.name,
        cost: Number(entry.cost),
      })),
      by_model: [],
      daily_trend: dailyTrend.rows.map((entry) => ({
        date: entry.day,
        cost: Number(entry.cost),
      })),
      totalTokensInput: Number(row.total_tokens_input),
      totalTokensOutput: Number(row.total_tokens_output),
      totalCostUsd,
      totalWallTimeMs: Number(row.total_wall_time_ms),
      eventCount: Number(row.event_count),
    };
  }

  private buildSummaryScope(
    tenantId: string,
    filters: { from?: string; to?: string; workflowId?: string },
  ): {
    whereClause: string;
    values: unknown[];
    workflowBudgetClause: string;
  } {
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

    return {
      whereClause: conditions.join(' AND '),
      values,
      workflowBudgetClause: filters.workflowId ? 'AND id = $2' : '',
    };
  }
}
