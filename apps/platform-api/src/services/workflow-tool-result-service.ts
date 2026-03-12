import type { DatabaseClient, DatabasePool } from '../db/database.js';

interface StoredWorkflowToolResultRow {
  response: Record<string, unknown>;
}

export class WorkflowToolResultService {
  constructor(private readonly pool: DatabasePool) {}

  async getResult(
    tenantId: string,
    workflowId: string,
    toolName: string,
    requestId: string,
    client?: DatabaseClient,
  ): Promise<Record<string, unknown> | null> {
    const db = client ?? this.pool;
    const result = await db.query<StoredWorkflowToolResultRow>(
      `SELECT response
         FROM workflow_tool_results
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND tool_name = $3
          AND request_id = $4
        LIMIT 1`,
      [tenantId, workflowId, toolName, requestId],
    );
    return result.rows[0]?.response ?? null;
  }

  async storeResult(
    tenantId: string,
    workflowId: string,
    toolName: string,
    requestId: string,
    response: Record<string, unknown>,
    client?: DatabaseClient,
  ): Promise<Record<string, unknown>> {
    const db = client ?? this.pool;
    const inserted = await db.query<StoredWorkflowToolResultRow>(
      `INSERT INTO workflow_tool_results (
         tenant_id, workflow_id, tool_name, request_id, response
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id, workflow_id, tool_name, request_id)
       DO NOTHING
       RETURNING response`,
      [tenantId, workflowId, toolName, requestId, response],
    );
    if (inserted.rowCount) {
      return inserted.rows[0].response;
    }

    const existing = await this.getResult(tenantId, workflowId, toolName, requestId, client);
    return existing ?? response;
  }
}
