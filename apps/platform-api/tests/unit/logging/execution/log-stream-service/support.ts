import { vi } from 'vitest';

export function createMockPool() {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    release: vi.fn(),
  };
  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue(mockClient),
    },
    client: mockClient,
  };
}

export function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    tenant_id: 'tenant-1',
    trace_id: 'trace-1',
    span_id: 'span-1',
    parent_span_id: null,
    source: 'runtime',
    category: 'llm',
    level: 'info',
    operation: 'llm.chat_stream',
    status: 'completed',
    duration_ms: 1200,
    payload: {},
    error: null,
    workspace_id: null,
    workflow_id: 'wf-1',
    workflow_name: 'Test Workflow',
    workspace_name: 'Test Workspace',
    task_id: 'task-1',
    work_item_id: 'work-item-1',
    stage_name: 'implementation',
    activation_id: 'activation-1',
    is_orchestrator_task: true,
    execution_backend: 'runtime_only',
    tool_owner: 'runtime',
    task_title: 'Implement feature',
    role: 'developer',
    actor_type: 'worker',
    actor_id: 'w-1',
    actor_name: 'worker-01',
    resource_type: null,
    resource_id: null,
    resource_name: null,
    created_at: '2026-03-09T15:30:00.000Z',
    ...overrides,
  };
}
