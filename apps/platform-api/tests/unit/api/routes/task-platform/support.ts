import fastify from 'fastify';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

export const artifactLocalRoot = resolve('tmp/artifacts');
export const VALID_ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';

export interface TaskPlatformAppOptions {
  pgPool: Record<string, unknown>;
  workspaceService: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export function buildTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    workflow_id: 'workflow-1',
    workspace_id: 'workspace-1',
    work_item_id: 'work-item-1',
    stage_name: 'design',
    activation_id: null,
    assigned_agent_id: 'agent-1',
    is_orchestrator_task: false,
    state: 'in_progress',
    ...overrides,
  };
}

export function createWorkflowReplayPool(workflowId: string, toolName: string) {
  const storedResults = new Map<string, Record<string, unknown>>();
  const taskRow = buildTaskRow();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('FROM workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, expect.any(String)]);
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = storedResults.get(key);
        return response
          ? { rowCount: 1, rows: [{ response }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        expect(params).toHaveLength(7);
        expect(params?.slice(0, 4)).toEqual(['tenant-1', workflowId, toolName, expect.any(String)]);
        expect(params?.[4]).toEqual(expect.any(Object));
        const key = `${params?.[0]}:${params?.[1]}:${params?.[2]}:${params?.[3]}`;
        const response = params?.[4] as Record<string, unknown>;
        if (storedResults.has(key)) {
          return { rowCount: 0, rows: [] };
        }
        storedResults.set(key, response);
        return { rowCount: 1, rows: [{ response }] };
      }
      throw new Error(`Unexpected SQL in replay pool client: ${sql}`);
    }),
    release: vi.fn(),
  };

  return {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, workflow_id, workspace_id')) {
        return { rowCount: 1, rows: [taskRow] };
      }
      throw new Error(`Unexpected SQL in replay pool: ${sql}`);
    }),
  };
}

export async function createTaskPlatformApp(
  options: TaskPlatformAppOptions,
  registerRoutes: (app: ReturnType<typeof fastify>) => Promise<unknown> | unknown,
) {
  const app = fastify();
  registerErrorHandler(app);
  app.decorate('pgPool', options.pgPool as never);
  app.decorate('workspaceService', options.workspaceService as never);
  app.decorate('config', {
    ARTIFACT_STORAGE_BACKEND: 'local',
    ARTIFACT_LOCAL_ROOT: artifactLocalRoot,
    ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
    ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    ...options.config,
  } as never);
  await registerRoutes(app);
  return app;
}
