import type { DatabaseClient, DatabasePool } from '../db/database.js';

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
