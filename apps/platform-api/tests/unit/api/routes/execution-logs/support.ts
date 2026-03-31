import fastify from 'fastify';
import { vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

export interface ExecutionLogsRouteLogService {
  insertBatch: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
  export: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
  operationValues: ReturnType<typeof vi.fn>;
  roleValues: ReturnType<typeof vi.fn>;
  actorKindValues: ReturnType<typeof vi.fn>;
  workflowValues: ReturnType<typeof vi.fn>;
  operations: ReturnType<typeof vi.fn>;
  roles: ReturnType<typeof vi.fn>;
  actors: ReturnType<typeof vi.fn>;
}

export const unsafeRow = {
  id: '1',
  tenant_id: 'tenant-1',
  trace_id: 'trace-1',
  span_id: 'span-1',
  parent_span_id: null,
  source: 'runtime',
  category: 'auth',
  level: 'error',
  operation: 'auth.oauth_connection.failed',
  status: 'failed',
  duration_ms: 10,
  payload: {
    api_key: 'sk-live-secret',
    nested: {
      authorization: 'Bearer top-secret',
      secret_ref: 'secret:OPENAI_API_KEY',
      safe: 'visible',
    },
    predecessor_handoff_resolution_present: true,
    predecessor_handoff_source: 'local_work_item',
    workspace_memory_index_present: true,
    workspace_memory_index_count: 2,
    workspace_artifact_index_present: true,
    workspace_artifact_index_count: 1,
    max_output_tokens_omission_reason: 'not_supplied_in_task_contract',
  },
  error: {
    code: 'AUTH_FAILED',
    message: 'Bearer sk-live-secret leaked',
    stack: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  },
  workspace_id: null,
  workflow_id: 'workflow-1',
  workflow_name: 'Flow',
  workspace_name: null,
  task_id: 'task-1',
  work_item_id: 'work-item-1',
  stage_name: 'review',
  activation_id: 'activation-1',
  is_orchestrator_task: false,
  execution_backend: 'runtime_plus_task',
  tool_owner: 'task',
  task_title: 'Run work',
  role: 'developer',
  actor_type: 'system',
  actor_id: 'worker-1',
  actor_name: 'worker-1',
  resource_type: null,
  resource_id: null,
  resource_name: null,
  created_at: '2026-03-11T00:00:00.000Z',
};

export function createExecutionLogsLogService(
  overrides: Partial<ExecutionLogsRouteLogService> = {},
): ExecutionLogsRouteLogService {
  return {
    insertBatch: vi.fn(),
    query: vi.fn().mockResolvedValue({
      data: [],
      pagination: {
        per_page: 100,
        has_more: false,
        next_cursor: null,
        prev_cursor: null,
      },
    }),
    getById: vi.fn(),
    export: vi.fn(),
    stats: vi.fn().mockResolvedValue({ groups: [], totals: {} }),
    operationValues: vi.fn().mockResolvedValue([]),
    roleValues: vi.fn().mockResolvedValue([]),
    actorKindValues: vi.fn().mockResolvedValue([]),
    workflowValues: vi.fn().mockResolvedValue([]),
    operations: vi.fn().mockResolvedValue([]),
    roles: vi.fn().mockResolvedValue([]),
    actors: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

export async function createExecutionLogsApp(
  overrides: Partial<ExecutionLogsRouteLogService> = {},
) {
  const { executionLogRoutes } = await import('../../../../../src/api/routes/execution-logs/execution-logs.routes.js');
  const app = fastify();
  const logService = createExecutionLogsLogService(overrides);

  app.decorate('config', { EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 1000 } as never);
  app.decorate('logStreamService', { subscribe: vi.fn(() => () => {}) } as never);
  app.decorate('logService', logService as never);
  registerErrorHandler(app);
  await app.register(executionLogRoutes);

  return { app, logService };
}
