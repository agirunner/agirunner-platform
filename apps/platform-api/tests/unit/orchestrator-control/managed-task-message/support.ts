import fastify from 'fastify';
import { vi } from 'vitest';

import { registerErrorHandler } from '../../../../src/errors/error-handler.js';
import { orchestratorControlRoutes } from '../../../../src/api/routes/orchestrator-control.routes.js';

export interface ManagedTaskMessageRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  task_id: string;
  orchestrator_task_id: string;
  activation_id: string;
  stage_name: string;
  worker_id: string | null;
  request_id: string;
  urgency: string;
  message: string;
  delivery_state: string;
  delivery_attempt_count: number;
  last_delivery_attempt_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

export interface ManagedTaskRecord {
  id: string;
  workflow_id: string;
  is_orchestrator_task: boolean;
  state: string;
  assigned_worker_id: string | null;
  stage_name: string | null;
}

export function createManagedTask(overrides: Partial<ManagedTaskRecord> = {}): ManagedTaskRecord {
  return {
    id: 'task-managed-1',
    workflow_id: 'workflow-1',
    is_orchestrator_task: false,
    state: 'in_progress',
    assigned_worker_id: 'worker-1',
    stage_name: 'implementation',
    ...overrides,
  };
}

export function createManagedTaskMessageRow(
  overrides: Partial<ManagedTaskMessageRow> = {},
): ManagedTaskMessageRow {
  return {
    id: 'message-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    task_id: 'task-managed-1',
    orchestrator_task_id: 'task-orch-message',
    activation_id: 'activation-1',
    stage_name: 'implementation',
    worker_id: 'worker-1',
    request_id: 'msg-1',
    urgency: 'important',
    message: 'Focus on the failing API regression first.',
    delivery_state: 'pending_delivery',
    delivery_attempt_count: 0,
    last_delivery_attempt_at: null,
    delivered_at: null,
    created_at: new Date('2026-03-12T00:00:00.000Z'),
    ...overrides,
  };
}

export async function createManagedTaskMessageHarness(options: {
  managedTask?: ManagedTaskRecord;
  messageRow?: ManagedTaskMessageRow;
  clientQuery: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>;
  poolQuery: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>;
  sendToWorker?: ReturnType<typeof vi.fn>;
}) {
  const taskService = {
    createTask: vi.fn(),
    getTask: vi.fn(),
  };
  const emit = vi.fn(async () => undefined);
  const sendToWorker = options.sendToWorker ?? vi.fn(() => true);
  const client = {
    query: vi.fn(options.clientQuery),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(options.poolQuery),
    connect: vi.fn(async () => client),
  };

  const app = fastify();
  registerErrorHandler(app);
  app.decorate('pgPool', pool);
  app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
  app.decorate('eventService', { emit });
  app.decorate('workflowService', { getWorkflowBudget: vi.fn() });
  app.decorate('workerConnectionHub', { sendToWorker });
  app.decorate('taskService', taskService);
  app.decorate('workspaceService', {
    patchWorkspaceMemory: vi.fn(),
    removeWorkspaceMemory: vi.fn(),
  });

  await app.register(orchestratorControlRoutes);

  return {
    app,
    client,
    pool,
    emit,
    sendToWorker,
    taskService,
    managedTask: options.managedTask ?? createManagedTask(),
    messageRow: options.messageRow ?? createManagedTaskMessageRow(),
  };
}
