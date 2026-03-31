import { beforeEach, vi } from 'vitest';

type MockWorkflowStageProjection = {
  stageRows: Array<Record<string, unknown>>;
  currentStage: string | null;
  activeStages: string[];
};

const {
  loadWorkflowStageProjectionMock,
  readRequiredPositiveIntegerRuntimeDefaultMock,
  readWorkflowActivationTimingDefaultsMock,
} = vi.hoisted(() => ({
  loadWorkflowStageProjectionMock: vi.fn<() => Promise<MockWorkflowStageProjection>>(async () => ({
    stageRows: [],
    currentStage: null,
    activeStages: [],
  })),
  readRequiredPositiveIntegerRuntimeDefaultMock:
    vi.fn<(db: unknown, tenantId: string, key: string) => Promise<number>>(),
  readWorkflowActivationTimingDefaultsMock: vi.fn<(db: unknown, tenantId: string) => Promise<{
    activationDelayMs: number;
    heartbeatIntervalMs: number;
    staleAfterMs: number;
  }>>(),
}));

export const DEFAULT_RUNTIME_DEFAULTS: Record<string, number> = {
  'tasks.default_timeout_minutes': 30,
  'agent.max_iterations': 500,
  'agent.llm_max_retries': 5,
};

vi.mock('../../../src/services/platform-config/platform-timing-defaults.js', () => ({
  readWorkflowActivationTimingDefaults: readWorkflowActivationTimingDefaultsMock,
}));

vi.mock('../../../src/services/runtime-defaults/runtime-default-values.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/services/runtime-defaults/runtime-default-values.js')>(
      '../../../src/services/runtime-defaults/runtime-default-values.js',
    );
  return {
    ...actual,
    readRequiredPositiveIntegerRuntimeDefault: readRequiredPositiveIntegerRuntimeDefaultMock,
  };
});

vi.mock('../../../src/services/workflow-stage/workflow-stage-projection.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/services/workflow-stage/workflow-stage-projection.js')>(
      '../../../src/services/workflow-stage/workflow-stage-projection.js',
    );
  return {
    ...actual,
    loadWorkflowStageProjection: loadWorkflowStageProjectionMock,
  };
});

import {
  WorkflowActivationDispatchService as WorkflowActivationDispatchServiceClass,
} from '../../../src/services/workflow-activation-dispatch/workflow-activation-dispatch-service.js';

const WorkflowActivationDispatchService = WorkflowActivationDispatchServiceClass;

beforeEach(() => {
  loadWorkflowStageProjectionMock.mockReset();
  loadWorkflowStageProjectionMock.mockResolvedValue({
    stageRows: [],
    currentStage: null,
    activeStages: [],
  });
  readWorkflowActivationTimingDefaultsMock.mockReset();
  readWorkflowActivationTimingDefaultsMock.mockResolvedValue({
    activationDelayMs: 60_000,
    heartbeatIntervalMs: 300_000,
    staleAfterMs: 300_000,
  });
  readRequiredPositiveIntegerRuntimeDefaultMock.mockReset();
  readRequiredPositiveIntegerRuntimeDefaultMock.mockImplementation(async (_db, _tenantId, key: string) => {
    const value = DEFAULT_RUNTIME_DEFAULTS[key];
    if (value == null) {
      throw new Error(`unexpected runtime default lookup: ${key}`);
    }
    return value;
  });
});

function readInsertedActivationTask(params: unknown[] | undefined) {
  return {
    workItemId: params?.[2],
    input: params?.[7],
    roleConfig: params?.[8],
    environment: params?.[9],
    resourceBindings: params?.[10],
    activationId: params?.[11],
    requestId: params?.[12],
    timeoutMinutes: params?.[13],
    maxIterations: params?.[14],
    llmMaxRetries: params?.[15],
    metadata: params?.[16],
  };
}

function expectWorkflowStageProjection(projection: {
  currentStage?: string | null;
  activeStages?: string[];
}) {
  loadWorkflowStageProjectionMock.mockResolvedValueOnce({
    stageRows: [],
    currentStage: projection.currentStage ?? null,
    activeStages: projection.activeStages ?? [],
  });
}

export {
  WorkflowActivationDispatchService,
  expectWorkflowStageProjection,
  loadWorkflowStageProjectionMock,
  readInsertedActivationTask,
  readRequiredPositiveIntegerRuntimeDefaultMock,
  readWorkflowActivationTimingDefaultsMock,
};
