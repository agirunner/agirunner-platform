import { vi } from 'vitest';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const WORKER_ID = '00000000-0000-0000-0000-000000000099';
export const PLAYBOOK_ID = '00000000-0000-0000-0000-000000000010';
export const RUNTIME_ID = '00000000-0000-0000-0000-000000000020';

export function createMockPool() {
  return { query: vi.fn() };
}

export const sampleDesiredState = {
  id: WORKER_ID,
  tenant_id: TENANT_ID,
  worker_name: 'test-worker',
  role: 'developer',
  pool_kind: 'specialist',
  runtime_image: 'agirunner-runtime:latest',
  cpu_limit: '2',
  memory_limit: '2g',
  network_policy: 'restricted',
  environment: {},
  llm_provider: null,
  llm_model: null,
  llm_api_key_secret_ref: null,
  replicas: 1,
  enabled: true,
  restart_requested: false,
  draining: false,
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
  updated_by: null,
};

export const sampleDesiredStateWithSecrets = {
  ...sampleDesiredState,
  environment: {
    SAFE_NAME: 'worker-a',
    API_TOKEN: 'top-secret-token',
    opaque: 'sk-live-readback-secret',
    secrets_bundle: {
      username: 'service-user',
    },
    nested: {
      authorization: 'Bearer nested-secret',
      keep_ref: 'secret:RUNTIME_KEY',
    },
  },
  llm_api_key_secret_ref: 'secret:OPENAI_API_KEY',
};

export const sampleActualState = {
  id: '00000000-0000-0000-0000-000000000050',
  desired_state_id: WORKER_ID,
  container_id: 'abc123',
  container_status: 'running',
  cpu_usage_percent: 12.5,
  memory_usage_bytes: 1048576,
  network_rx_bytes: 500,
  network_tx_bytes: 300,
  started_at: new Date(),
  last_updated: new Date(),
};

export const sampleActiveTaskState = {
  desired_state_id: WORKER_ID,
  active_task_id: '00000000-0000-0000-0000-000000000123',
};

export function createRuntimeTargetDefaultRows(overrides: Record<string, string> = {}) {
  const defaults = {
    global_max_specialists: '12',
    specialist_runtime_default_image: 'agirunner-runtime:local',
    specialist_runtime_default_cpu: '2',
    specialist_runtime_default_memory: '256m',
    specialist_runtime_default_pull_policy: 'if-not-present',
    specialist_runtime_bootstrap_claim_timeout_seconds: '30',
    specialist_runtime_drain_grace_seconds: '30',
    'container_manager.hung_runtime_stale_after_seconds': '90',
    'container_manager.runtime_log_max_size_mb': '10',
    'container_manager.runtime_log_max_files': '3',
    ...overrides,
  };
  return Object.entries(defaults).map(([config_key, config_value]) => ({ config_key, config_value }));
}

export function createFleetServiceMock(overrides: Record<string, unknown> = {}) {
  return {
    listWorkers: vi.fn(),
    createWorker: vi.fn(),
    updateWorker: vi.fn(),
    deleteWorker: vi.fn(),
    restartWorker: vi.fn(),
    drainWorker: vi.fn(),
    listContainers: vi.fn(),
    getContainerStats: vi.fn(),
    pruneStaleContainers: vi.fn(),
    reportActualState: vi.fn(),
    listImages: vi.fn(),
    reportImage: vi.fn(),
    requestImagePull: vi.fn(),
    getQueueDepth: vi.fn(),
    getRuntimeTargets: vi.fn(),
    getReconcileSnapshot: vi.fn(),
    recordHeartbeat: vi.fn(),
    listHeartbeats: vi.fn(),
    getFleetStatus: vi.fn(),
    recordFleetEvent: vi.fn(),
    listFleetEvents: vi.fn(),
    drainRuntime: vi.fn(),
    removeHeartbeat: vi.fn(),
    ...overrides,
  };
}

