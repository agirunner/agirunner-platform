import type { DatabasePool } from '../db/database.js';

interface ReadyTaskRow {
  id: string;
  tenant_id: string;
  capabilities_required: string[];
}

export interface DispatchWorkerCandidate {
  id: string;
  capabilities: string[];
  task_load: number;
  quality_score: number;
  created_at: Date;
}

interface ClaimedTaskRow {
  id: string;
  workflow_id: string | null;
  project_id: string | null;
  [key: string]: unknown;
}

interface ExpiredDispatch {
  tenantId: string;
  taskId: string;
  workerId: string;
}

export async function findReadyTasks(pool: DatabasePool, limit: number): Promise<ReadyTaskRow[]> {
  const result = await pool.query<ReadyTaskRow>(
    `SELECT id, tenant_id, capabilities_required
     FROM tasks
     WHERE state = 'ready'
     ORDER BY CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC, created_at ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function findDispatchCandidateWorker(
  pool: DatabasePool,
  tenantId: string,
  connectedWorkerIds: string[],
  requiredCapabilities: string[],
): Promise<string | null> {
  const candidates = await findDispatchCandidateWorkers(pool, tenantId, connectedWorkerIds, requiredCapabilities);
  return candidates[0]?.id ?? null;
}

/**
 * Returns all dispatch-eligible worker candidates sorted by quality and load.
 */
export async function findDispatchCandidateWorkers(
  pool: DatabasePool,
  tenantId: string,
  connectedWorkerIds: string[],
  requiredCapabilities: string[],
): Promise<DispatchWorkerCandidate[]> {
  const result = await pool.query<DispatchWorkerCandidate>(
    `SELECT w.id,
            w.capabilities,
            w.quality_score,
            w.created_at,
            COUNT(t.id) FILTER (WHERE t.state IN ('claimed','running')) AS task_load
     FROM workers w
     LEFT JOIN tasks t ON t.assigned_worker_id = w.id
     WHERE w.tenant_id = $1
       AND w.id = ANY($2::uuid[])
       AND w.status IN ('online','busy')
       AND w.circuit_breaker_state <> 'open'
       AND w.capabilities @> $3::text[]
     GROUP BY w.id
     ORDER BY w.quality_score DESC, task_load ASC, w.created_at ASC`,
    [tenantId, connectedWorkerIds, requiredCapabilities],
  );

  return result.rows;
}

export async function claimTaskForWorker(
  pool: DatabasePool,
  taskId: string,
  tenantId: string,
  workerId: string,
): Promise<ClaimedTaskRow | null> {
  const result = await pool.query<ClaimedTaskRow>(
    `UPDATE tasks
     SET state = 'claimed',
         state_changed_at = now(),
         assigned_worker_id = $3,
         claimed_at = now(),
         metadata = metadata || jsonb_build_object('dispatch_pending', true)
     WHERE id = $1 AND tenant_id = $2 AND state = 'ready'
     RETURNING *`,
    [taskId, tenantId, workerId],
  );

  return result.rows[0] ?? null;
}

export async function resetTaskClaim(pool: DatabasePool, tenantId: string, taskId: string): Promise<void> {
  await pool.query(
    `UPDATE tasks
     SET state = 'ready', assigned_worker_id = NULL, claimed_at = NULL, metadata = metadata - 'dispatch_pending'
     WHERE tenant_id = $1 AND id = $2 AND state = 'claimed'`,
    [tenantId, taskId],
  );
}

export async function markWorkerBusy(pool: DatabasePool, tenantId: string, workerId: string, taskId: string): Promise<void> {
  await pool.query(
    `UPDATE workers
     SET status = CASE WHEN status = 'draining' THEN status ELSE 'busy' END,
         current_task_id = COALESCE(current_task_id, $3)
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, workerId, taskId],
  );
}

export async function acknowledgeTaskAssignment(
  pool: DatabasePool,
  tenantId: string,
  taskId: string,
  workerId: string,
  agentId?: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE tasks
     SET assigned_agent_id = COALESCE($4, assigned_agent_id),
         metadata = metadata - 'dispatch_pending'
     WHERE tenant_id = $1 AND id = $2 AND assigned_worker_id = $3 AND state = 'claimed'
     RETURNING id`,
    [tenantId, taskId, workerId, agentId ?? null],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function resetExpiredDispatch(
  pool: DatabasePool,
  dispatch: ExpiredDispatch,
): Promise<ClaimedTaskRow | null> {
  const result = await pool.query<ClaimedTaskRow>(
    `UPDATE tasks
     SET state = 'ready',
         state_changed_at = now(),
         assigned_worker_id = NULL,
         assigned_agent_id = NULL,
         claimed_at = NULL,
         metadata = metadata - 'dispatch_pending'
     WHERE tenant_id = $1 AND id = $2 AND state = 'claimed' AND assigned_worker_id = $3
     RETURNING id, workflow_id, project_id`,
    [dispatch.tenantId, dispatch.taskId, dispatch.workerId],
  );

  return result.rows[0] ?? null;
}
