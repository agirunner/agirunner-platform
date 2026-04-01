import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from '../api.js';
import { writeSession } from '../auth/session.js';

import {
  createDashboardApiClientStub,
  resetDashboardApiTestEnvironment,
} from './test-support/create-dashboard-api.js';

describe('dashboard api system surfaces', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('sends bearer token when loading metrics if an in-memory access token exists', async () => {
    writeSession({ accessToken: 'metrics-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const body = await api.getMetrics();

    expect(body).toBe('ok');
    const [, options] = vi.mocked(fetcher).mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer metrics-token');
  });

  it('loads metrics using cookie-only auth when no in-memory access token exists', async () => {
    writeSession({ accessToken: null, tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const body = await api.getMetrics();

    expect(body).toBe('ok');
    const [, options] = vi.mocked(fetcher).mock.calls[0];
    expect(options?.headers).toBeUndefined();
    expect(options?.credentials).toBe('include');
  });

  it('loads the cost dashboard summary through the shared dashboard client contract', async () => {
    writeSession({ accessToken: 'cost-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            today: 1,
            this_week: 2,
            this_month: 3,
            budget_total: 4,
            budget_remaining: 1,
            by_workflow: [],
            by_model: [],
            daily_trend: [],
            totalTokensInput: 10,
            totalTokensOutput: 20,
            totalCostUsd: 3,
            totalWallTimeMs: 400,
            eventCount: 2,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const summary = await api.getCostSummary();

    expect(summary.totalCostUsd).toBe(3);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/metering/summary',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('calls runtime customization endpoints with typed dashboard methods', async () => {
    writeSession({ accessToken: 'runtime-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              state: 'unconfigured',
              customization_enabled: false,
              active_digest: 'ghcr.io/agirunner/runtime:base',
              resolved_reasoning: {
                orchestrator_level: 'medium',
                internal_workers_level: 'medium',
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              valid: true,
              manifest: {
                template: 'node',
                base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              build_id: 'build-1',
              state: 'gated',
              link_ready: true,
              digest: 'sha256:build',
              manifest: {
                template: 'node',
                base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const status = await api.getCustomizationStatus();
    const validation = await api.validateCustomization({
      manifest: {
        template: 'node',
        base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
      },
    });
    const build = await api.createCustomizationBuild({
      manifest: {
        template: 'node',
        base_image: 'ghcr.io/agirunner/runtime@sha256:1234',
      },
    });

    expect(status.state).toBe('unconfigured');
    expect(validation.valid).toBe(true);
    expect(build.build_id).toBe('build-1');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/status',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/validate',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/builds',
    );
  });

  it('supports reconstruct export and build link through the dashboard api', async () => {
    writeSession({ accessToken: 'runtime-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              state: 'linked',
              manifest: {
                template: 'python',
                base_image: 'ghcr.io/agirunner/runtime@sha256:5678',
              },
              profile: {
                manifest: {
                  template: 'python',
                  base_image: 'ghcr.io/agirunner/runtime@sha256:5678',
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              artifact_type: 'profile',
              format: 'yaml',
              content: 'name: runtime-profile',
              redaction_applied: true,
              scan_passed: true,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              build_id: 'build-2',
              state: 'linked',
              linked: true,
              configured_digest: 'sha256:build-2',
              active_digest: 'sha256:base',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const reconstruct = await api.reconstructCustomization();
    const exported = await api.exportCustomization({ artifact_type: 'profile', format: 'yaml' });
    const linked = await api.linkCustomizationBuild({ build_id: 'build-2' });

    expect(reconstruct.profile.manifest.template).toBe('python');
    expect(exported.redaction_applied).toBe(true);
    expect(linked.linked).toBe(true);
    const validateCall = vi.mocked(fetcher).mock.calls[1];
    expect(validateCall[0]).toBe(
      'http://localhost:8080/api/v1/runtime/customizations/reconstruct/export',
    );
    expect(validateCall[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('loads split fleet pool status and fleet worker desired state through typed dashboard methods', async () => {
    writeSession({ accessToken: 'fleet-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              global_max_runtimes: 20,
              total_running: 9,
              total_idle: 4,
              total_executing: 7,
              total_draining: 1,
              worker_pools: [
                {
                  pool_kind: 'orchestrator',
                  desired_workers: 2,
                  desired_replicas: 2,
                  enabled_workers: 2,
                  draining_workers: 0,
                  running_containers: 2,
                },
                {
                  pool_kind: 'specialist',
                  desired_workers: 4,
                  desired_replicas: 8,
                  enabled_workers: 4,
                  draining_workers: 1,
                  running_containers: 7,
                },
              ],
              by_playbook: [],
              by_playbook_pool: [
                {
                  playbook_id: 'pb-1',
                  playbook_name: 'Ship V2',
                  pool_kind: 'orchestrator',
                  pool_mode: 'warm',
                  max_runtimes: 2,
                  running: 2,
                  idle: 0,
                  executing: 1,
                  pending_tasks: 0,
                  active_workflows: 3,
                  draining: 0,
                },
              ],
              recent_events: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'worker-1',
                worker_name: 'orchestrator-1',
                role: 'orchestrator',
                pool_kind: 'orchestrator',
                runtime_image: 'ghcr.io/agirunner/orchestrator:latest',
                cpu_limit: '2',
                memory_limit: '2g',
                network_policy: 'restricted',
                environment: {},
                llm_provider: 'openai',
                llm_model: 'gpt-5',
                llm_api_key_secret_ref_configured: true,
                replicas: 1,
                enabled: true,
                restart_requested: false,
                draining: false,
                version: 1,
                created_at: '2026-03-11T00:00:00.000Z',
                updated_at: '2026-03-11T00:00:00.000Z',
                updated_by: null,
                actual: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'runtime:runtime-1',
                kind: 'runtime',
                container_id: 'runtime-container-1',
                name: 'runtime-specialist-1',
                state: 'running',
                status: 'Up 4 minutes',
                image: 'ghcr.io/agirunner/runtime:local',
                cpu_limit: '2',
                memory_limit: '1536m',
                started_at: '2026-03-21T18:24:00.000Z',
                last_seen_at: '2026-03-21T18:30:00.000Z',
                role_name: 'developer',
                playbook_id: 'playbook-1',
                playbook_name: 'Bug Investigation',
                workflow_id: 'workflow-1',
                workflow_name: 'Fix login bug',
                task_id: 'task-1',
                task_title: 'Investigate auth timeout',
                activity_state: 'executing',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              platform_api: {
                component: 'platform-api',
                image: 'ghcr.io/agirunner/agirunner-platform-api:0.1.0-rc.1',
                image_digest: 'sha256:platform-api',
                version: '0.1.0-rc.1',
                revision: 'abcdef123456',
                status: 'Up 5 minutes',
                started_at: '2026-03-31T18:22:00.000Z',
              },
              dashboard: {
                component: 'dashboard',
                image: 'ghcr.io/agirunner/agirunner-platform-dashboard:local',
                image_digest: null,
                version: 'local',
                revision: 'unlabeled',
                status: 'Up 5 minutes',
                started_at: '2026-03-31T18:22:30.000Z',
              },
              container_manager: null,
              runtimes: [
                {
                  image: 'ghcr.io/agirunner/agirunner-runtime:0.1.0-rc.1',
                  image_digest: 'sha256:runtime',
                  version: '0.1.0-rc.1',
                  revision: 'fedcba654321',
                  total_containers: 2,
                  orchestrator_containers: 1,
                  specialist_runtime_containers: 1,
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'worker-2',
              worker_name: 'specialist-1',
              role: 'developer',
              pool_kind: 'specialist',
              runtime_image: 'ghcr.io/agirunner/specialist:latest',
              cpu_limit: '2',
              memory_limit: '2g',
              network_policy: 'restricted',
              environment: {},
              llm_provider: null,
              llm_model: null,
              llm_api_key_secret_ref_configured: false,
              replicas: 2,
              enabled: true,
              restart_requested: false,
              draining: false,
              version: 1,
              created_at: '2026-03-11T00:00:00.000Z',
              updated_at: '2026-03-11T00:00:00.000Z',
              updated_by: null,
              actual: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'worker-2',
              worker_name: 'specialist-1',
              role: 'reviewer',
              pool_kind: 'specialist',
              runtime_image: 'ghcr.io/agirunner/specialist:stable',
              cpu_limit: '4',
              memory_limit: '4g',
              network_policy: 'open',
              environment: { FEATURE_FLAG: 'enabled' },
              llm_provider: 'openai',
              llm_model: 'gpt-5',
              llm_api_key_secret_ref_configured: true,
              replicas: 3,
              enabled: false,
              restart_requested: false,
              draining: false,
              version: 2,
              created_at: '2026-03-11T00:00:00.000Z',
              updated_at: '2026-03-11T01:00:00.000Z',
              updated_by: null,
              actual: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const status = await api.fetchFleetStatus();
    const workers = await api.fetchFleetWorkers();
    const liveContainers = await api.fetchLiveContainers();
    const versionSummary = await api.fetchVersionSummary();
    const created = await api.createFleetWorker({
      workerName: 'specialist-1',
      role: 'developer',
      runtimeImage: 'ghcr.io/agirunner/specialist:latest',
      poolKind: 'specialist',
    });
    const updated = await api.updateFleetWorker('worker-2', {
      role: 'reviewer',
      runtimeImage: 'ghcr.io/agirunner/specialist:stable',
      cpuLimit: '4',
      memoryLimit: '4g',
      networkPolicy: 'open',
      environment: { FEATURE_FLAG: 'enabled' },
      llmProvider: 'openai',
      llmModel: 'gpt-5',
      llmApiKeySecretRef: 'secret:tenant/openai',
      replicas: 3,
      enabled: false,
    });
    await api.restartFleetWorker('worker-2');
    await api.drainFleetWorker('worker-2');
    await api.deleteFleetWorker('worker-2');

    expect(status.worker_pools[0]?.pool_kind).toBe('orchestrator');
    expect(status.by_playbook_pool[0]?.pool_kind).toBe('orchestrator');
    expect(workers[0]?.pool_kind).toBe('orchestrator');
    expect(liveContainers[0]?.kind).toBe('runtime');
    expect(versionSummary.platform_api?.version).toBe('0.1.0-rc.1');
    expect(created.pool_kind).toBe('specialist');
    expect(updated.llm_api_key_secret_ref_configured).toBe(true);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe('http://localhost:8080/api/v1/fleet/status');
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe('http://localhost:8080/api/v1/fleet/workers');
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/fleet/live-containers',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/fleet/version-summary',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe('http://localhost:8080/api/v1/fleet/workers');
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2/restart',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2/drain',
    );
    expect(vi.mocked(fetcher).mock.calls[8][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2',
    );
  });
});
