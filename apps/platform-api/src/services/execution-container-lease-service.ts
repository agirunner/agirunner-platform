import type { DatabasePool, DatabaseQueryable } from '../db/database.js';
import { readRequiredPositiveIntegerRuntimeDefault, GLOBAL_MAX_SPECIALISTS_RUNTIME_KEY } from './runtime-default-values.js';

const ACTIVE_TASK_STATES_FOR_EXECUTION_LEASES = [
  'claimed',
  'in_progress',
  'awaiting_approval',
  'cancelling',
] as const;

export interface ReserveExecutionContainerLeaseInput {
  taskId: string;
  workflowId: string | null;
  workItemId: string | null;
  role: string;
  agentId: string;
  workerId: string | null;
}

export interface ReserveExecutionContainerLeaseResult {
  reserved: boolean;
  active: number;
  limit: number;
  leaseId: string | null;
}

export class ExecutionContainerLeaseService {
  constructor(private readonly pool: DatabasePool) {}

  async reserveForTask(
    tenantId: string,
    input: ReserveExecutionContainerLeaseInput,
    executor?: DatabaseQueryable,
  ): Promise<ReserveExecutionContainerLeaseResult> {
    const db = executor ?? this.pool;
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtext($1)) AS locked',
      [`execution_container_leases:${tenantId}`],
    );
    await this.releaseInactiveLeases(tenantId, db);

    const limit = await readRequiredPositiveIntegerRuntimeDefault(
      db,
      tenantId,
      GLOBAL_MAX_SPECIALISTS_RUNTIME_KEY,
    );
    const activeBefore = await this.countActiveLeases(tenantId, db);
    if (activeBefore >= limit) {
      return {
        reserved: false,
        active: activeBefore,
        limit,
        leaseId: null,
      };
    }

    const insert = await db.query<{ id: string }>(
      `INSERT INTO execution_container_leases (
         tenant_id, task_id, workflow_id, work_item_id, role_name, agent_id, worker_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, task_id)
       DO UPDATE SET
         workflow_id = EXCLUDED.workflow_id,
         work_item_id = EXCLUDED.work_item_id,
         role_name = EXCLUDED.role_name,
         agent_id = EXCLUDED.agent_id,
         worker_id = EXCLUDED.worker_id,
         acquired_at = NOW(),
         released_at = NULL,
         released_reason = NULL
       WHERE execution_container_leases.released_at IS NOT NULL
       RETURNING id`,
      [
        tenantId,
        input.taskId,
        input.workflowId,
        input.workItemId,
        input.role,
        input.agentId,
        input.workerId,
      ],
    );

    const insertRowCount = insert.rowCount ?? 0;
    return {
      reserved: insertRowCount > 0,
      active: insertRowCount > 0 ? activeBefore + 1 : activeBefore,
      limit,
      leaseId: insert.rows[0]?.id ?? null,
    };
  }

  async releaseForTask(
    tenantId: string,
    taskId: string,
    executor?: DatabaseQueryable,
  ): Promise<boolean> {
    const db = executor ?? this.pool;
    const result = await db.query(
      `UPDATE execution_container_leases
          SET released_at = NOW(),
              released_reason = COALESCE(released_reason, 'task_released')
        WHERE tenant_id = $1
          AND task_id = $2
          AND released_at IS NULL`,
      [tenantId, taskId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async countActiveLeases(
    tenantId: string,
    db: DatabaseQueryable,
  ): Promise<number> {
    const result = await db.query<{ total: number | string }>(
      `SELECT COUNT(*)::int AS total
         FROM execution_container_leases
        WHERE tenant_id = $1
          AND released_at IS NULL`,
      [tenantId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private async releaseInactiveLeases(
    tenantId: string,
    db: DatabaseQueryable,
  ): Promise<void> {
    await db.query(
      `UPDATE execution_container_leases AS lease
          SET released_at = NOW(),
              released_reason = 'task_no_longer_active'
        WHERE lease.tenant_id = $1
          AND lease.released_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM tasks
             WHERE tasks.tenant_id = lease.tenant_id
               AND tasks.id = lease.task_id
               AND tasks.assigned_agent_id IS NOT NULL
               AND tasks.state::text = ANY($2::text[])
          )`,
      [tenantId, [...ACTIVE_TASK_STATES_FOR_EXECUTION_LEASES]],
    );
  }
}
