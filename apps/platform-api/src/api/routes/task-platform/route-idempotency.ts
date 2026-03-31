import type { FastifyInstance } from 'fastify';

import type { DatabaseClient } from '../../../db/database.js';
import { TaskToolResultService } from '../../../services/task/task-tool-result-service.js';
import { WorkflowToolResultService } from '../../../services/workflow-operations/workflow-tool-result-service.js';

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

export async function runIdempotentPublicTaskOperatorAction<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  loadTask: (tenantId: string, taskId: string) => Promise<unknown>,
  tenantId: string,
  taskId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: DatabaseClient | undefined) => Promise<T>,
): Promise<T> {
  return runIdempotentTaskRouteAction(
    app,
    toolResultService,
    loadTask,
    tenantId,
    taskId,
    toolName,
    requestId,
    run,
  );
}

export async function runIdempotentTaskRouteAction<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  loadTask: (tenantId: string, taskId: string) => Promise<unknown>,
  tenantId: string,
  taskId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: DatabaseClient | undefined) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId) {
    return run(undefined);
  }

  const workflowId = requestId
    ? await loadTaskWorkflowId(loadTask, tenantId, taskId)
    : null;
  if (!workflowId) {
    return runIdempotentTaskBackedTaskAction(
      app,
      new TaskToolResultService(app.pgPool),
      tenantId,
      taskId,
      toolName,
      normalizedRequestId,
      run,
    );
  }

  return runIdempotentWorkflowBackedTaskAction(
    app,
    toolResultService,
    tenantId,
    workflowId,
    toolName,
    normalizedRequestId,
    run,
  );
}

async function runIdempotentTaskBackedTaskAction<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: TaskToolResultService,
  tenantId: string,
  taskId: string,
  toolName: string,
  requestId: string,
  run: (client: DatabaseClient | undefined) => Promise<T>,
): Promise<T> {
  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    await toolResultService.lockRequest(
      tenantId,
      taskId,
      toolName,
      requestId,
      client,
    );
    const existing = await toolResultService.getResult(
      tenantId,
      taskId,
      toolName,
      requestId,
      client,
    );
    if (existing) {
      await client.query('COMMIT');
      return existing as T;
    }

    const response = await run(client);
    const stored = await toolResultService.storeResult(
      tenantId,
      taskId,
      toolName,
      requestId,
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
