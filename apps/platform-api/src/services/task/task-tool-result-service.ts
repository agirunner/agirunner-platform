import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError } from '../../errors/domain-errors.js';
import { areJsonValuesEquivalent } from '../json-equivalence.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';

export const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

interface StoredTaskToolResultRow {
  response: Record<string, unknown>;
}

export class TaskToolResultService {
  constructor(private readonly pool: DatabasePool) {}

  async lockRequest(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string,
    client?: DatabaseClient,
  ): Promise<void> {
    const db = client ?? this.pool;
    await db.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [`${tenantId}:${taskId}`, `${toolName}:${requestId}`],
    );
  }

  async getResult(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string,
    client?: DatabaseClient,
  ): Promise<Record<string, unknown> | null> {
    const db = client ?? this.pool;
    const result = await db.query<StoredTaskToolResultRow>(
      `SELECT response
         FROM task_tool_results
        WHERE tenant_id = $1
          AND task_id = $2
          AND tool_name = $3
          AND request_id = $4
        LIMIT 1`,
      [tenantId, taskId, toolName, requestId],
    );
    return result.rows[0]?.response ?? null;
  }

  async storeResult(
    tenantId: string,
    taskId: string,
    toolName: string,
    requestId: string,
    response: Record<string, unknown>,
    client?: DatabaseClient,
  ): Promise<Record<string, unknown>> {
    const db = client ?? this.pool;
    const inserted = await db.query<StoredTaskToolResultRow>(
      `INSERT INTO task_tool_results (
         tenant_id, task_id, tool_name, request_id, response
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id, task_id, tool_name, request_id)
       DO NOTHING
       RETURNING response`,
      [tenantId, taskId, toolName, requestId, response],
    );
    if (inserted.rowCount) {
      return inserted.rows[0].response;
    }

    const existing = await this.getResult(tenantId, taskId, toolName, requestId, client);
    if (!existing) {
      throw new Error('Failed to load existing task tool result after conflict');
    }
    if (!areJsonValuesEquivalent(existing, response)) {
      throw new ConflictError('task tool request_id replay does not match the stored result');
    }
    logSafetynetTriggered(
      IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
      'idempotent task tool mutation replay returned stored result',
      { task_id: taskId, tool_name: toolName, request_id: requestId },
    );
    return existing;
  }
}
