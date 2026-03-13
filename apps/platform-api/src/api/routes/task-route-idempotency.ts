import type { FastifyInstance } from 'fastify';

import type { DatabaseClient } from '../../db/database.js';
import { WorkflowToolResultService } from '../../services/workflow-tool-result-service.js';

export async function loadTaskWorkflowId(
  loadTask: (tenantId: string, taskId: string) => Promise<unknown>,
  tenantId: string,
  taskId: string,
): Promise<string | null> {
  const task = await loadTask(tenantId, taskId) as Record<string, unknown>;
  return typeof task.workflow_id === 'string' && task.workflow_id.trim().length > 0
    ? task.workflow_id
    : null;
}

export async function runIdempotentWorkflowBackedTaskAction<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string | null,
  toolName: string,
  requestId: string | undefined,
  run: (client: DatabaseClient | undefined) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId || !workflowId) {
    return run(undefined);
  }

  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    await toolResultService.lockRequest(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      client,
    );
    const existing = await toolResultService.getResult(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      client,
    );
    if (existing) {
      await client.query('COMMIT');
      return existing as T;
    }

    const response = await run(client);
    const stored = await toolResultService.storeResult(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      response,
      client,
    );
    await client.query('COMMIT');
    return stored as T;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
