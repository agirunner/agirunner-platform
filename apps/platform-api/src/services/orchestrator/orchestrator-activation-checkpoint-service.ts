import type { DatabaseClient, DatabasePool } from '../../db/database.js';

export interface OrchestratorActivationCheckpoint {
  activation_id?: string | null;
  trigger?: string | null;
  what_changed?: string[];
  current_working_state?: string | null;
  next_expected_event?: string | null;
  important_ids?: string[];
  important_artifacts?: string[];
  recent_memory_keys?: string[];
}

export interface ActivationFinishTaskScope {
  task_id: string;
  workflow_id: string;
  work_item_id?: string | null;
  activation_id?: string | null;
}

export class OrchestratorActivationCheckpointService {
  constructor(private readonly pool: DatabasePool) {}

  async persistCheckpoint(
    tenantId: string,
    taskId: string,
    checkpoint: OrchestratorActivationCheckpoint,
    db: DatabaseClient | DatabasePool = this.pool,
  ): Promise<OrchestratorActivationCheckpoint> {
    const normalized = normalizeCheckpoint(checkpoint);
    const result = await db.query<{ metadata: Record<string, unknown> | null }>(
      `UPDATE tasks
          SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_activation_checkpoint', $3::jsonb),
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND is_orchestrator_task = true
      RETURNING metadata`,
      [tenantId, taskId, normalized],
    );
    if (!result.rowCount) {
      throw new Error('Failed to persist orchestrator activation checkpoint');
    }
    return normalizeCheckpoint(
      asRecord(result.rows[0]?.metadata).last_activation_checkpoint as OrchestratorActivationCheckpoint,
    );
  }

  async persistDerivedCheckpoint(
    tenantId: string,
    taskScope: ActivationFinishTaskScope,
    db: DatabaseClient | DatabasePool = this.pool,
  ): Promise<OrchestratorActivationCheckpoint> {
    const continuity = await this.loadContinuityState(
      tenantId,
      taskScope.workflow_id,
      taskScope.work_item_id ?? null,
      db,
    );
    const checkpoint = normalizeCheckpoint({
      activation_id: trimOrNull(taskScope.activation_id),
      trigger: await this.loadActivationTrigger(
        tenantId,
        taskScope.workflow_id,
        taskScope.activation_id ?? null,
        db,
      ),
      current_working_state: trimOrNull(continuity.status_summary),
      next_expected_event: trimOrNull(continuity.next_expected_event),
      important_ids: normalizeStringList(compactStringValues([
        taskScope.work_item_id,
        ...(continuity.active_subordinate_tasks ?? []),
      ])),
    });
    return this.persistCheckpoint(tenantId, taskScope.task_id, checkpoint, db);
  }

  private async loadActivationTrigger(
    tenantId: string,
    workflowId: string,
    activationId: string | null,
    db: DatabaseClient | DatabasePool,
  ): Promise<string | null | undefined> {
    if (trimOrNull(activationId) == null) {
      return undefined;
    }
    const result = await db.query<{ event_type: string }>(
      `SELECT event_type
         FROM workflow_activations
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND (id = $3 OR activation_id = $3)
        ORDER BY CASE WHEN event_type = 'heartbeat' THEN 1 ELSE 0 END ASC,
                 queued_at ASC,
                 id ASC
        LIMIT 1`,
      [tenantId, workflowId, activationId],
    );
    return trimOrNull(result.rows[0]?.event_type);
  }

  private async loadContinuityState(
    tenantId: string,
    workflowId: string,
    workItemId: string | null,
    db: DatabaseClient | DatabasePool,
  ): Promise<{
    status_summary?: string | null;
    next_expected_event?: string | null;
    active_subordinate_tasks?: string[];
  }> {
    if (trimOrNull(workItemId) == null) {
      return {};
    }
    const result = await db.query<{ metadata: Record<string, unknown> | null }>(
      `SELECT metadata
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    const continuity = asRecord(asRecord(result.rows[0]?.metadata).orchestrator_finish_state);
    return {
      status_summary: trimOrNull(continuity.status_summary as string | null | undefined),
      next_expected_event: trimOrNull(continuity.next_expected_event as string | null | undefined),
      active_subordinate_tasks: normalizeStringList(
        Array.isArray(continuity.active_subordinate_tasks)
          ? continuity.active_subordinate_tasks as string[]
          : undefined,
      ),
    };
  }
}

function normalizeCheckpoint(
  checkpoint: OrchestratorActivationCheckpoint,
): OrchestratorActivationCheckpoint {
  return compactRecord({
    activation_id: trimOrNull(checkpoint.activation_id),
    trigger: trimOrNull(checkpoint.trigger),
    what_changed: normalizeStringList(checkpoint.what_changed),
    current_working_state: trimOrNull(checkpoint.current_working_state),
    next_expected_event: trimOrNull(checkpoint.next_expected_event),
    important_ids: normalizeStringList(checkpoint.important_ids),
    important_artifacts: normalizeStringList(checkpoint.important_artifacts),
    recent_memory_keys: normalizeStringList(checkpoint.recent_memory_keys),
  });
}

function normalizeStringList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const filtered = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

function compactStringValues(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

function trimOrNull(value: string | null | undefined): string | null | undefined {
  if (typeof value !== 'string') {
    return value ?? undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
