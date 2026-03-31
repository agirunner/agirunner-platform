import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../src/errors/error-handler.js';
import { createFleetServiceMock } from './support.js';

vi.mock('../../../src/auth/fastify-auth-hook.js', () => ({
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
    const { fleetRoutes } = await import('../../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('fleetService', createFleetServiceMock({
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
    }));

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
    const { fleetRoutes } = await import('../../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const listWorkers = vi.fn().mockResolvedValue([]);
    app.decorate('fleetService', createFleetServiceMock({ listWorkers }));

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
    const { fleetRoutes } = await import('../../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    const getReconcileSnapshot = vi.fn().mockResolvedValue({
      desired_states: [{ id: 'worker-1', worker_name: 'worker-a' }],
      runtime_targets: [{ playbook_id: 'pb-1', pool_kind: 'orchestrator' }],
      heartbeats: [{ runtime_id: 'rt-1', pool_kind: 'orchestrator', state: 'idle' }],
      container_manager_config: {
        reconcile_interval_seconds: 5,
        stop_timeout_seconds: 30,
        shutdown_task_stop_timeout_seconds: 2,
        docker_action_buffer_seconds: 15,
        global_max_runtimes: 10,
        runtime_log_max_size_mb: 10,
        runtime_log_max_files: 3,
      },
    });
    app.decorate('fleetService', createFleetServiceMock({ getReconcileSnapshot }));

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
      container_manager_config: {
        reconcile_interval_seconds: 5,
        stop_timeout_seconds: 30,
        shutdown_task_stop_timeout_seconds: 2,
        docker_action_buffer_seconds: 15,
        global_max_runtimes: 10,
        runtime_log_max_size_mb: 10,
        runtime_log_max_files: 3,
      },
    });
  });

  it('does not serialize llm api key secret refs on worker create responses', async () => {
    const { fleetRoutes } = await import('../../../src/api/routes/fleet.routes.js');

    app = fastify();
    registerErrorHandler(app);
    app.decorate('fleetService', createFleetServiceMock({
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
    }));

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
});

