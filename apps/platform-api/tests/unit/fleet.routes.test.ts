import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('fleet routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('does not serialize llm api key secret refs on worker list responses', async () => {
    const { fleetRoutes } = await import('../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('fleetService', {
      listWorkers: vi.fn().mockResolvedValue([
        {
          id: 'worker-1',
          tenant_id: 'tenant-1',
          worker_name: 'worker-a',
          role: 'developer',
          pool_kind: 'specialist',
          runtime_image: 'agirunner-runtime:latest',
          cpu_limit: '2',
          memory_limit: '2g',
          network_policy: 'restricted',
          environment: {
            API_TOKEN: 'redacted://fleet-environment-secret',
            SAFE_NAME: 'worker-a',
          },
          llm_provider: 'openai',
          llm_model: 'gpt-5',
          llm_api_key_secret_ref_configured: true,
          replicas: 1,
          enabled: true,
          restart_requested: false,
          draining: false,
          version: 1,
          created_at: new Date('2026-03-12T00:00:00.000Z'),
          updated_at: new Date('2026-03-12T00:00:00.000Z'),
          updated_by: null,
          actual: [],
        },
      ]),
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
      recordHeartbeat: vi.fn(),
      listHeartbeats: vi.fn(),
      getFleetStatus: vi.fn(),
      recordFleetEvent: vi.fn(),
      listFleetEvents: vi.fn(),
      drainRuntime: vi.fn(),
    });

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fleet/workers',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data[0]).not.toHaveProperty('llm_api_key_secret_ref');
    expect(body.data).toEqual([
      expect.objectContaining({
        worker_name: 'worker-a',
        llm_api_key_secret_ref_configured: true,
        environment: {
          API_TOKEN: 'redacted://fleet-environment-secret',
          SAFE_NAME: 'worker-a',
        },
      }),
    ]);
  });

  it('passes the enabled filter through worker list requests', async () => {
    const { fleetRoutes } = await import('../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const listWorkers = vi.fn().mockResolvedValue([]);
    app.decorate('fleetService', {
      listWorkers,
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
      recordHeartbeat: vi.fn(),
      listHeartbeats: vi.fn(),
      getFleetStatus: vi.fn(),
      recordFleetEvent: vi.fn(),
      listFleetEvents: vi.fn(),
      drainRuntime: vi.fn(),
    });

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fleet/workers?enabled=true',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listWorkers).toHaveBeenCalledWith('tenant-1', { enabledOnly: true });
  });

  it('returns a reconcile snapshot for worker-scope fleet consumers', async () => {
    const { fleetRoutes } = await import('../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const getReconcileSnapshot = vi.fn().mockResolvedValue({
      desired_states: [{ id: 'worker-1', worker_name: 'worker-a' }],
      runtime_targets: [{ playbook_id: 'pb-1', pool_kind: 'orchestrator' }],
      heartbeats: [{ runtime_id: 'rt-1', pool_kind: 'orchestrator', state: 'idle' }],
    });
    app.decorate('fleetService', {
      listWorkers: vi.fn(),
      getReconcileSnapshot,
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
      recordHeartbeat: vi.fn(),
      listHeartbeats: vi.fn(),
      getFleetStatus: vi.fn(),
      recordFleetEvent: vi.fn(),
      listFleetEvents: vi.fn(),
      drainRuntime: vi.fn(),
    });

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fleet/reconcile-snapshot',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(getReconcileSnapshot).toHaveBeenCalledWith('tenant-1');
    expect(response.json().data).toEqual({
      desired_states: [{ id: 'worker-1', worker_name: 'worker-a' }],
      runtime_targets: [{ playbook_id: 'pb-1', pool_kind: 'orchestrator' }],
      heartbeats: [{ runtime_id: 'rt-1', pool_kind: 'orchestrator', state: 'idle' }],
    });
  });

  it('does not serialize llm api key secret refs on worker create responses', async () => {
    const { fleetRoutes } = await import('../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('fleetService', {
      listWorkers: vi.fn(),
      createWorker: vi.fn().mockResolvedValue({
        id: 'worker-1',
        tenant_id: 'tenant-1',
        worker_name: 'worker-a',
        role: 'developer',
        pool_kind: 'specialist',
        runtime_image: 'agirunner-runtime:latest',
        cpu_limit: '2',
        memory_limit: '2g',
        network_policy: 'restricted',
        environment: {
          API_TOKEN: 'redacted://fleet-environment-secret',
          SAFE_NAME: 'worker-a',
        },
        llm_provider: 'openai',
        llm_model: 'gpt-5',
        llm_api_key_secret_ref_configured: true,
        replicas: 1,
        enabled: true,
        restart_requested: false,
        draining: false,
        version: 1,
        created_at: new Date('2026-03-12T00:00:00.000Z'),
        updated_at: new Date('2026-03-12T00:00:00.000Z'),
        updated_by: null,
      }),
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
      recordHeartbeat: vi.fn(),
      listHeartbeats: vi.fn(),
      getFleetStatus: vi.fn(),
      recordFleetEvent: vi.fn(),
      listFleetEvents: vi.fn(),
      drainRuntime: vi.fn(),
    });

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fleet/workers',
      headers: { authorization: 'Bearer test' },
      payload: {
        workerName: 'worker-a',
        role: 'developer',
        poolKind: 'specialist',
        runtimeImage: 'agirunner-runtime:latest',
        cpuLimit: '2',
        memoryLimit: '2g',
        networkPolicy: 'restricted',
        environment: {
          API_TOKEN: 'top-secret-token',
          SAFE_NAME: 'worker-a',
        },
        llmApiKeySecretRef: 'secret:OPENAI_API_KEY',
        replicas: 1,
        enabled: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('secret:OPENAI_API_KEY');
    const body = response.json();
    expect(body.data).not.toHaveProperty('llm_api_key_secret_ref');
    expect(body.data).toEqual(
      expect.objectContaining({
        worker_name: 'worker-a',
        llm_api_key_secret_ref_configured: true,
        environment: {
          API_TOKEN: 'redacted://fleet-environment-secret',
          SAFE_NAME: 'worker-a',
        },
      }),
    );
  });

  it('accepts snake_case actual-state payloads from workers', async () => {
    const { fleetRoutes } = await import('../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const reportActualState = vi.fn().mockResolvedValue(undefined);
    app.decorate('fleetService', {
      listWorkers: vi.fn(),
      createWorker: vi.fn(),
      updateWorker: vi.fn(),
      deleteWorker: vi.fn(),
      restartWorker: vi.fn(),
      drainWorker: vi.fn(),
      listContainers: vi.fn(),
      getContainerStats: vi.fn(),
      pruneStaleContainers: vi.fn(),
      reportActualState,
      listImages: vi.fn(),
      reportImage: vi.fn(),
      requestImagePull: vi.fn(),
      getQueueDepth: vi.fn(),
      getRuntimeTargets: vi.fn(),
      recordHeartbeat: vi.fn(),
      listHeartbeats: vi.fn(),
      getFleetStatus: vi.fn(),
      recordFleetEvent: vi.fn(),
      listFleetEvents: vi.fn(),
      drainRuntime: vi.fn(),
    });

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fleet/workers/actual-state',
      headers: { authorization: 'Bearer test' },
      payload: {
        desired_state_id: '00000000-0000-0000-0000-000000000111',
        container_id: 'container-1',
        container_status: 'running',
        cpu_usage_percent: 12.5,
        memory_usage_bytes: 2048,
        network_rx_bytes: 100,
        network_tx_bytes: 200,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(reportActualState).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000111',
      'container-1',
      'running',
      {
        cpuPercent: 12.5,
        memoryBytes: 2048,
        rxBytes: 100,
        txBytes: 200,
      },
    );
  });

  it('returns 400 instead of 500 when actual-state payload is missing required ids', async () => {
    const { fleetRoutes } = await import('../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const reportActualState = vi.fn().mockResolvedValue(undefined);
    app.decorate('fleetService', {
      listWorkers: vi.fn(),
      createWorker: vi.fn(),
      updateWorker: vi.fn(),
      deleteWorker: vi.fn(),
      restartWorker: vi.fn(),
      drainWorker: vi.fn(),
      listContainers: vi.fn(),
      getContainerStats: vi.fn(),
      pruneStaleContainers: vi.fn(),
      reportActualState,
      listImages: vi.fn(),
      reportImage: vi.fn(),
      requestImagePull: vi.fn(),
      getQueueDepth: vi.fn(),
      getRuntimeTargets: vi.fn(),
      recordHeartbeat: vi.fn(),
      listHeartbeats: vi.fn(),
      getFleetStatus: vi.fn(),
      recordFleetEvent: vi.fn(),
      listFleetEvents: vi.fn(),
      drainRuntime: vi.fn(),
    });

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fleet/workers/actual-state',
      headers: { authorization: 'Bearer test' },
      payload: {
        container_status: 'running',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(reportActualState).not.toHaveBeenCalled();
  });

  it('wraps fleet heartbeat responses in the standard data envelope', async () => {
    const { fleetRoutes } = await import('../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('fleetService', {
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
      recordHeartbeat: vi.fn().mockResolvedValue({
        runtime_id: 'runtime-1',
        playbook_id: 'playbook-1',
        pool_kind: 'orchestrator',
        state: 'idle',
        task_id: null,
        should_drain: false,
      }),
      listHeartbeats: vi.fn(),
      getFleetStatus: vi.fn(),
      recordFleetEvent: vi.fn(),
      listFleetEvents: vi.fn(),
      drainRuntime: vi.fn(),
    });

    await app.register(fleetRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fleet/heartbeat',
      headers: { authorization: 'Bearer test' },
      payload: {
        runtime_id: '00000000-0000-0000-0000-000000000111',
        playbook_id: '00000000-0000-0000-0000-000000000222',
        pool_kind: 'orchestrator',
        state: 'idle',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        runtime_id: 'runtime-1',
        playbook_id: 'playbook-1',
        pool_kind: 'orchestrator',
        state: 'idle',
        task_id: null,
        should_drain: false,
      },
    });
  });
});
