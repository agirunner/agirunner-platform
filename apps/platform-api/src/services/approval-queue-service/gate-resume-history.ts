import type { DatabasePool } from '../../db/database.js';

interface GateResumeActivationRow {
  gate_id: string | null;
  id: string;
  workflow_id: string;
  activation_id: string | null;
  request_id: string | null;
  reason: string;
  event_type: string;
  state: string;
  queued_at: Date;
  started_at: Date | null;
  consumed_at: Date | null;
  completed_at: Date | null;
  summary: string | null;
  error: Record<string, unknown> | null;
  task_id: string | null;
  task_title: string | null;
  task_state: string | null;
  task_started_at: Date | null;
  task_completed_at: Date | null;
}

interface GateResumeTaskRecord {
  id: string;
  title: string | null;
  state: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface GateResumeHistoryEntry {
  activation_id: string;
  state: string;
  event_type: string;
  reason: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  error: Record<string, unknown> | null;
  latest_event_at: string;
  event_count: number;
  task: GateResumeTaskRecord | null;
}

export async function loadGateResumeHistory(
  pool: DatabasePool,
  tenantId: string,
  gateIds: string[],
  workflowId?: string,
): Promise<Map<string, GateResumeHistoryEntry[]>> {
  if (gateIds.length === 0) {
    return new Map();
  }

  const values: unknown[] = [tenantId, gateIds];
  const workflowClause = workflowId
    ? (() => {
        values.push(workflowId);
        return 'AND wa.workflow_id = $3';
      })()
    : '';

  const result = await pool.query<GateResumeActivationRow>(
    `SELECT wa.payload->>'gate_id' AS gate_id,
            wa.id::text AS id,
            wa.workflow_id::text AS workflow_id,
            wa.activation_id::text AS activation_id,
            wa.request_id,
            wa.reason,
            wa.event_type,
            wa.state,
            wa.queued_at,
            wa.started_at,
            wa.consumed_at,
            wa.completed_at,
            wa.summary,
            wa.error,
            orchestrator_task.id::text AS task_id,
            orchestrator_task.title AS task_title,
            orchestrator_task.state AS task_state,
            orchestrator_task.started_at AS task_started_at,
            orchestrator_task.completed_at AS task_completed_at
       FROM workflow_activations wa
       LEFT JOIN tasks orchestrator_task
         ON orchestrator_task.tenant_id = wa.tenant_id
        AND orchestrator_task.workflow_id = wa.workflow_id
        AND orchestrator_task.activation_id = COALESCE(wa.activation_id, wa.id)
        AND orchestrator_task.is_orchestrator_task = true
      WHERE wa.tenant_id = $1
        AND wa.payload->>'gate_id' = ANY($2::text[])
        ${workflowClause}
      ORDER BY wa.payload->>'gate_id' ASC, wa.queued_at ASC, wa.id ASC`,
    values,
  );

  const historyByGateId = new Map<string, GateResumeActivationRow[]>();
  for (const row of result.rows) {
    if (!row.gate_id) {
      continue;
    }
    const existing = historyByGateId.get(row.gate_id);
    if (existing) {
      existing.push(row);
      continue;
    }
    historyByGateId.set(row.gate_id, [row]);
  }

  const response = new Map<string, GateResumeHistoryEntry[]>();
  for (const [gateId, rows] of historyByGateId.entries()) {
    response.set(gateId, rowsToGateResumeEntries(rows));
  }
  return response;
}

function rowsToGateResumeEntries(rows: GateResumeActivationRow[]): GateResumeHistoryEntry[] {
  return groupActivationRows(rows).map((activationRows) => {
    const anchor = findActivationAnchor(activationRows);
    const latestEvent = activationRows[activationRows.length - 1] ?? anchor;
    return {
      activation_id: anchor.activation_id ?? anchor.id,
      state: deriveActivationState(anchor),
      event_type: anchor.event_type,
      reason: anchor.reason,
      queued_at: anchor.queued_at.toISOString(),
      started_at: anchor.started_at?.toISOString() ?? null,
      completed_at: anchor.completed_at?.toISOString() ?? null,
      summary: anchor.summary ?? null,
      error: anchor.error ?? null,
      latest_event_at: latestEvent.queued_at.toISOString(),
      event_count: activationRows.length,
      task: readResumeTask(anchor),
    };
  });
}

function groupActivationRows(rows: GateResumeActivationRow[]): GateResumeActivationRow[][] {
  const grouped = new Map<string, GateResumeActivationRow[]>();
  for (const row of rows) {
    const key = row.activation_id ?? row.id;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
      continue;
    }
    grouped.set(key, [row]);
  }
  return Array.from(grouped.values());
}

function findActivationAnchor(rows: GateResumeActivationRow[]): GateResumeActivationRow {
  const anchorId = rows[0]?.activation_id ?? rows[0]?.id;
  return rows.find((row) => row.id === anchorId) ?? rows[0];
}

function deriveActivationState(row: GateResumeActivationRow): string {
  if (row.consumed_at) {
    return 'completed';
  }
  if ((row.activation_id && !row.consumed_at) || row.state === 'processing') {
    return 'processing';
  }
  return 'queued';
}

function readResumeTask(row: GateResumeActivationRow): GateResumeTaskRecord | null {
  if (!row.task_id) {
    return null;
  }
  return {
    id: row.task_id,
    title: row.task_title ?? null,
    state: row.task_state ?? null,
    started_at: row.task_started_at?.toISOString() ?? null,
    completed_at: row.task_completed_at?.toISOString() ?? null,
  };
}
