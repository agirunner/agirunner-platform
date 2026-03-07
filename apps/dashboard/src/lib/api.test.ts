import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSearchResults, createDashboardApi } from './api.js';
import { clearSession, readSession, writeSession } from './session.js';

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

describe('dashboard api auth/session behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockLocalStorage();
    clearSession();
  });

  it('refreshes token and retries request when access token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const listPipelines = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 401: token expired'))
      .mockResolvedValueOnce({
        data: [],
        pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 },
      });

    const client = {
      refreshSession: vi.fn().mockResolvedValue({ token: 'fresh-token' }),
      setAccessToken: vi.fn(),
      listPipelines,
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await api.listPipelines();

    expect(client.refreshSession).toHaveBeenCalledTimes(1);
    expect(client.setAccessToken).toHaveBeenCalledWith('fresh-token');
    expect(listPipelines).toHaveBeenCalledTimes(2);
    expect(readSession()).toEqual({ accessToken: 'fresh-token', tenantId: 'tenant-1' });
  });

  it('clears session and redirects to login when refresh token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const locationAssign = vi.fn();
    vi.stubGlobal('window', {
      location: {
        assign: locationAssign,
      },
    });

    const client = {
      refreshSession: vi.fn().mockRejectedValue(new Error('HTTP 401: refresh expired')),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn().mockRejectedValue(new Error('HTTP 401: token expired')),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await expect(api.listPipelines()).rejects.toThrow('HTTP 401: refresh expired');
    expect(readSession()).toBeNull();
    expect(locationAssign).toHaveBeenCalledWith('/login');
  });

  it('persists tenant id but not access token after login', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi
        .fn()
        .mockResolvedValue({ token: 'ephemeral-token', tenant_id: 'tenant-1' }),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ab_admin_test_key');

    expect(readSession()).toEqual({ accessToken: 'ephemeral-token', tenantId: 'tenant-1' });
    expect(localStorage.getItem('agentbaton.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agentbaton.accessToken')).toBeNull();
  });

  it('calls server-side logout before clearing the local session', async () => {
    writeSession({ accessToken: 'logout-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { logged_out: true } }), { status: 200 }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    await api.logout();

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
    expect(readSession()).toBeNull();
  });

  it('lists templates and creates pipelines through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'tmpl-1',
              name: 'SDLC',
              slug: 'sdlc',
              version: 1,
              is_built_in: false,
              is_published: true,
              schema: {},
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn().mockResolvedValue({ id: 'pipe-1' }),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const templates = await api.listTemplates();
    const pipeline = await api.createPipeline({ template_id: 'tmpl-1', name: 'Test Run' });

    expect(templates.data).toHaveLength(1);
    expect(client.createPipeline).toHaveBeenCalledWith({ template_id: 'tmpl-1', name: 'Test Run' });
    expect(pipeline).toEqual({ id: 'pipe-1' });
  });

  it('sends bearer token when loading metrics if an in-memory access token exists', async () => {
    writeSession({ accessToken: 'metrics-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
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
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const body = await api.getMetrics();

    expect(body).toBe('ok');
    const [, options] = vi.mocked(fetcher).mock.calls[0];
    expect(options?.headers).toBeUndefined();
    expect(options?.credentials).toBe('include');
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
              active_digest: 'ghcr.io/agentbaton/runtime:base',
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
                base_image: 'ghcr.io/agentbaton/runtime@sha256:1234',
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
                base_image: 'ghcr.io/agentbaton/runtime@sha256:1234',
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const status = await api.getCustomizationStatus();
    const validation = await api.validateCustomization({
      manifest: {
        template: 'node',
        base_image: 'ghcr.io/agentbaton/runtime@sha256:1234',
      },
    });
    const build = await api.createCustomizationBuild({
      manifest: {
        template: 'node',
        base_image: 'ghcr.io/agentbaton/runtime@sha256:1234',
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
                base_image: 'ghcr.io/agentbaton/runtime@sha256:5678',
              },
              profile: {
                manifest: {
                  template: 'python',
                  base_image: 'ghcr.io/agentbaton/runtime@sha256:5678',
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
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
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

  it('calls workflow cockpit endpoints with typed dashboard methods', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'pipe-1', current_phase: 'review' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'pipe-1', phases: [] } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { pipeline_id: 'pipe-1', resolved_config: { retries: 2 } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ pipeline_id: 'pipe-1', kind: 'run_summary' }] }), {
          status: 200,
        }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.actOnPhaseGate('pipe-1', 'review', { action: 'approve' });
    await api.cancelPhase('pipe-1', 'release');
    const config = await api.getResolvedPipelineConfig('pipe-1', true);
    const timeline = await api.getProjectTimeline('project-1');

    expect(config.resolved_config).toEqual({ retries: 2 });
    expect(timeline[0].kind).toBe('run_summary');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/pipelines/pipe-1/phases/review/gate',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/pipelines/pipe-1/phases/release/cancel',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/pipelines/pipe-1/config/resolved?show_layers=true',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/timeline',
    );
  });

  it('lists projects and starts a planning pipeline through typed dashboard methods', async () => {
    writeSession({ accessToken: 'planning-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'project-1', name: 'Alpha', slug: 'alpha' }],
            meta: { total: 1 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'pipe-9', name: 'AI Planning' } }), {
          status: 201,
        }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const projects = await api.listProjects();
    const planning = await api.createPlanningPipeline('project-1', {
      brief: 'Plan the next workflow increment.',
      name: 'AI Planning',
    });

    expect(projects.data[0].id).toBe('project-1');
    expect((planning as { data?: { id?: string } }).data?.id).toBe('pipe-9');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/projects?per_page=50',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/planning-pipeline',
    );
  });

  it('loads content and memory surfaces through typed dashboard methods', async () => {
    writeSession({ accessToken: 'content-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'project-1',
              name: 'Atlas',
              slug: 'atlas',
              memory: {
                last_run_summary: { kind: 'run_summary' },
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
              id: 'project-1',
              name: 'Atlas',
              slug: 'atlas',
              memory: {
                last_run_summary: { kind: 'run_summary' },
                operator_note: { summary: 'check rollout' },
              },
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
                logical_name: 'project_brief',
                scope: 'project',
                source: 'repository',
                repository: 'origin',
                path: 'docs/brief.md',
                metadata: {},
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
                id: 'artifact-1',
                task_id: 'task-1',
                logical_path: 'artifact:pipe-1/report.json',
                content_type: 'application/json',
                size_bytes: 128,
                checksum_sha256: 'abc',
                metadata: {},
                retention_policy: {},
                created_at: '2026-03-07T00:00:00.000Z',
                download_url: '/api/v1/tasks/task-1/artifacts/artifact-1',
              },
            ],
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listPipelines: vi.fn(),
      exchangeApiKey: vi.fn(),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const project = await api.getProject('project-1');
    const updated = await api.patchProjectMemory('project-1', {
      key: 'operator_note',
      value: { summary: 'check rollout' },
    });
    const documents = await api.listPipelineDocuments('pipe-1');
    const artifacts = await api.listTaskArtifacts('task-1');

    expect(project.memory?.last_run_summary).toEqual({ kind: 'run_summary' });
    expect(updated.memory?.operator_note).toEqual({ summary: 'check rollout' });
    expect(documents[0].logical_name).toBe('project_brief');
    expect(artifacts[0].id).toBe('artifact-1');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe('http://localhost:8080/api/v1/projects/project-1');
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe('http://localhost:8080/api/v1/projects/project-1/memory');
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe('http://localhost:8080/api/v1/pipelines/pipe-1/documents');
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe('http://localhost:8080/api/v1/tasks/task-1/artifacts');
  });
});

describe('dashboard global search', () => {
  it('buildSearchResults creates task/pipeline/worker/agent route targets', () => {
    const results = buildSearchResults('build', {
      pipelines: [{ id: 'pipeline-1', name: 'Build Pipeline', state: 'running' }],
      tasks: [{ id: 'task-1', title: 'Build artifact', state: 'ready' }],
      workers: [{ id: 'worker-1', name: 'Builder worker', status: 'online' }],
      agents: [{ id: 'agent-1', name: 'Builder agent', status: 'idle' }],
    });

    expect(results.map((result) => result.type)).toEqual(['pipeline', 'task', 'worker', 'agent']);
    expect(results[0].href).toBe('/pipelines/pipeline-1');
    expect(results[1].href).toBe('/tasks/task-1');
    expect(results[2].href).toBe('/workers');
  });

  it('search() merges matches from all dashboard resources', async () => {
    writeSession({ accessToken: 'token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      listPipelines: vi.fn().mockResolvedValue({
        data: [{ id: 'pipeline-1', name: 'Test Pipeline', state: 'running' }],
      }),
      getPipeline: vi.fn(),
      createPipeline: vi.fn(),
      listTasks: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'task-1', title: 'Test task', state: 'ready' }] }),
      getTask: vi.fn(),
      listWorkers: vi
        .fn()
        .mockResolvedValue([{ id: 'worker-1', name: 'Test worker', status: 'online' }]),
      listAgents: vi
        .fn()
        .mockResolvedValue([{ id: 'agent-1', name: 'Test agent', status: 'idle' }]),
    };

    const api = createDashboardApi({ client: client as never });
    const results = await api.search('test');

    expect(results).toHaveLength(4);
    expect(client.listPipelines).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listTasks).toHaveBeenCalledWith({ per_page: 50 });
  });
});
