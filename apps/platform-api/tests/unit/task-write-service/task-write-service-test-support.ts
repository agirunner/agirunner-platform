import { vi } from 'vitest';
import * as TaskWriteServiceModule from '../../../src/services/task-write-service.js';
import * as DomainErrors from '../../../src/errors/domain-errors.js';

const { readRequiredPositiveIntegerRuntimeDefaultMock } = vi.hoisted(() => ({
  readRequiredPositiveIntegerRuntimeDefaultMock:
    vi.fn<(db: unknown, tenantId: string, key: string) => Promise<number>>(),
}));
const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../../src/services/runtime-default-values.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/services/runtime-default-values.js')>(
      '../../../src/services/runtime-default-values.js',
    );
  return {
    ...actual,
    readRequiredPositiveIntegerRuntimeDefault: readRequiredPositiveIntegerRuntimeDefaultMock,
  };
});

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import type { TaskWriteDependencies } from '../../../src/services/task-write-service.types.js';

export const ConflictError = DomainErrors.ConflictError;
export const ValidationError = DomainErrors.ValidationError;
export { readRequiredPositiveIntegerRuntimeDefaultMock, logSafetynetTriggeredMock };
export const TaskWriteService = TaskWriteServiceModule.TaskWriteService;

export const DEFAULT_RUNTIME_DEFAULTS: Record<string, number> = {
  'tasks.default_timeout_minutes': 30,
  'agent.max_iterations': 500,
  'agent.llm_max_retries': 5,
};

export function isLinkedWorkItemLookup(sql: string) {
  return sql.includes('FROM workflow_work_items wi')
    || sql.includes('SELECT workflow_id, stage_name FROM workflow_work_items');
}

export function isPlaybookDefinitionLookup(sql: string) {
  return sql.includes('JOIN playbooks pb');
}

export function createTaskWriteDependencies(
  overrides: Partial<TaskWriteDependencies> = {},
): TaskWriteDependencies {
  return {
    pool: {
      query: vi.fn(async () => {
        throw new Error('unexpected query');
      }),
    } as never,
    eventService: {
      emit: vi.fn(async () => undefined),
    } as never,
    config: {} as never,
    hasOrchestratorPermission: vi.fn(async () => false),
    subtaskPermission: 'create_subtasks',
    loadTaskOrThrow: vi.fn(),
    toTaskResponse: (task) => task,
    parallelismService: {
      shouldQueueForCapacity: vi.fn(async () => false),
    } as never,
    ...overrides,
  };
}

export function buildTaskWriteService(overrides: Partial<TaskWriteDependencies> = {}) {
  const deps = createTaskWriteDependencies(overrides);
  return {
    deps,
    service: new TaskWriteService(deps),
  };
}

export function createApiKeyIdentity(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    scope: 'admin',
    keyPrefix: 'admin-key',
    ...overrides,
  };
}

export function resetTaskWriteServiceMocks() {
  readRequiredPositiveIntegerRuntimeDefaultMock.mockReset();
  readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
    const value = DEFAULT_RUNTIME_DEFAULTS[key];
    if (value == null) {
      throw new Error(`unexpected runtime default lookup: ${key}`);
    }
    return value;
  });
  logSafetynetTriggeredMock.mockReset();
}
