import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSearchResults, createDashboardApi } from './api.js';
import { clearSession, readSession, writeSession } from './session.js';

function readApiSource() {
  return readFileSync(resolve(import.meta.dirname, './api.ts'), 'utf8');
}

function readInterfaceBlock(source: string, interfaceName: string) {
  const start =
    source.indexOf(`export interface ${interfaceName} {`) >= 0
      ? source.indexOf(`export interface ${interfaceName} {`)
      : source.indexOf(`interface ${interfaceName} {`);
  if (start < 0) {
    throw new Error(`Interface ${interfaceName} not found`);
  }
  const end = source.indexOf('\n}\n', start);
  if (end < 0) {
    throw new Error(`Interface ${interfaceName} end not found`);
  }
  return source.slice(start, end);
}

function readExportBlock(source: string, name: string) {
  const interfaceStart = source.indexOf(`export interface ${name} {`);
  if (interfaceStart >= 0) {
    const end = source.indexOf('\n}\n', interfaceStart);
    if (end < 0) {
      throw new Error(`Interface ${name} end not found`);
    }
    return source.slice(interfaceStart, end);
  }

  const typeStart = source.indexOf(`export type ${name} =`);
  if (typeStart < 0) {
    throw new Error(`Export ${name} not found`);
  }
  let depth = 0;
  let seenEquals = false;
  for (let index = typeStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '=') {
      seenEquals = true;
    }
    if (!seenEquals) {
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === ';' && depth === 0) {
      return source.slice(typeStart, index);
    }
  }
  throw new Error(`Type ${name} end not found`);
}

function mockBrowserStorage() {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  vi.stubGlobal('localStorage', createStorage(localStore));
  vi.stubGlobal('sessionStorage', createStorage(sessionStore));
}

function createStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('dashboard api auth/session behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockBrowserStorage();
    clearSession();
  });

  it('keeps live workflow contracts free of template and phase-era fields', () => {
    const workflowBlock = readExportBlock(readApiSource(), 'DashboardWorkflowRecord');

    expect(workflowBlock).not.toContain('template_id');
    expect(workflowBlock).not.toContain('template_name');
    expect(workflowBlock).not.toContain('template_version');
    expect(workflowBlock).not.toContain('current_phase');
    expect(workflowBlock).not.toContain('workflow_phase');
    expect(workflowBlock).not.toContain('phases');
  });

  it('keeps dashboard workflow and task records on canonical state aliases', () => {
    const source = readApiSource();
    const workflowBaseBlock = readInterfaceBlock(source, 'DashboardWorkflowRecordBase');
    const workflowBlock = readExportBlock(source, 'DashboardWorkflowRecord');
    const approvalTaskBlock = readInterfaceBlock(source, 'DashboardApprovalTaskRecord');

    expect(source).toContain('export type DashboardTaskState = TaskState;');
    expect(source).toContain('export type DashboardWorkflowState = WorkflowState;');
    expect(workflowBaseBlock).toContain('state: DashboardWorkflowState;');
    expect(workflowBlock).toContain("lifecycle: 'continuous';");
    expect(workflowBlock).toContain('current_stage?: never;');
    expect(workflowBlock).toContain("lifecycle?: 'standard' | null;");
    expect(workflowBlock).toContain('current_stage?: string | null;');
    expect(approvalTaskBlock).toContain('state: DashboardTaskState;');
  });

  it('exposes typed project settings posture in the dashboard api contract', () => {
    const source = readApiSource();
    const projectSettingsBlock = readExportBlock(source, 'DashboardProjectSettingsRecord');
    const projectSettingsInputBlock = readExportBlock(source, 'DashboardProjectSettingsInput');
    const projectSummaryBlock = readExportBlock(source, 'DashboardProjectListSummary');
    const projectRecordBlock = readExportBlock(source, 'DashboardProjectRecord');
    const patchProjectBlock = readExportBlock(source, 'DashboardProjectPatchInput');

    expect(projectSettingsBlock).toContain('default_branch?: string | null;');
    expect(projectSettingsBlock).toContain('git_user_name?: string | null;');
    expect(projectSettingsBlock).toContain('git_user_email?: string | null;');
    expect(projectSettingsBlock).toContain('credentials?: DashboardProjectCredentialPosture;');
    expect(projectSettingsBlock).toContain('model_overrides?: Record<string, DashboardRoleModelOverride>;');
    expect(projectSettingsBlock).toContain('project_brief?: string | null;');
    expect(projectSettingsInputBlock).toContain('credentials?: DashboardProjectCredentialInput;');
    expect(projectSettingsInputBlock).toContain('model_overrides?: Record<string, DashboardRoleModelOverride>;');
    expect(projectSummaryBlock).toContain('active_workflow_count: number;');
    expect(projectSummaryBlock).toContain('completed_workflow_count: number;');
    expect(projectSummaryBlock).toContain('attention_workflow_count: number;');
    expect(projectRecordBlock).toContain('settings?: DashboardProjectSettingsRecord;');
    expect(projectRecordBlock).toContain('summary?: DashboardProjectListSummary;');
    expect(patchProjectBlock).toContain('settings?: DashboardProjectSettingsInput;');
  });

  it('refreshes token and retries request when access token is expired', async () => {
    writeSession({ accessToken: 'expired-token', tenantId: 'tenant-1' });

    const listWorkflows = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 401: token expired'))
      .mockResolvedValueOnce({
        data: [],
        pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 },
      });

    const client = {
      refreshSession: vi.fn().mockResolvedValue({ token: 'fresh-token' }),
      setAccessToken: vi.fn(),
      listWorkflows,
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await api.listWorkflows();

    expect(client.refreshSession).toHaveBeenCalledTimes(1);
    expect(client.setAccessToken).toHaveBeenCalledWith('fresh-token');
    expect(listWorkflows).toHaveBeenCalledTimes(2);
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
      listWorkflows: vi.fn().mockRejectedValue(new Error('HTTP 401: token expired')),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });

    await expect(api.listWorkflows()).rejects.toThrow('HTTP 401: refresh expired');
    expect(readSession()).toBeNull();
    expect(locationAssign).toHaveBeenCalledWith('/login');
  });

  it('persists tenant id and session-scoped access token after login', async () => {
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi
        .fn()
        .mockResolvedValue({ token: 'ephemeral-token', tenant_id: 'tenant-1' }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({ client: client as never });
    await api.login('ar_admin_test_key');

    expect(readSession()).toEqual({ accessToken: 'ephemeral-token', tenantId: 'tenant-1' });
    expect(sessionStorage.getItem('agirunner.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agirunner.tenantId')).toBeNull();
    expect(localStorage.getItem('agirunner.accessToken')).toBeNull();
    expect(sessionStorage.getItem('agirunner.accessToken')).toBe('ephemeral-token');
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
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

  it('treats 204 no-content deletes as success for llm providers', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    await expect(api.deleteLlmProvider('provider-1')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/config/llm/providers/provider-1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-token',
        }),
      }),
    );
  });

  it('deletes project memory entries through the dedicated project-memory delete route', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'project-1', memory: {} } }), { status: 200 }),
      ) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    await api.removeProjectMemory('project-1', 'operator_note');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/projects/project-1/memory/operator_note',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-token',
        }),
      }),
    );
  });

  it('manages project-owned artifact files through dedicated project file routes', async () => {
    writeSession({ accessToken: 'artifact-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'file-1',
                project_id: 'project-1',
                key: 'brief-md',
                description: 'Initial brief',
                file_name: 'brief.md',
                content_type: 'text/markdown',
                size_bytes: 128,
                created_at: '2026-03-14T18:00:00.000Z',
                download_url: '/api/v1/projects/project-1/files/file-1/content',
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
                id: 'file-1',
                project_id: 'project-1',
                key: 'brief-md',
                description: 'Initial brief',
                file_name: 'brief.md',
                content_type: 'text/markdown',
                size_bytes: 128,
                created_at: '2026-03-14T18:00:00.000Z',
                download_url: '/api/v1/projects/project-1/files/file-1/content',
              },
            ],
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('artifact-bytes', {
          status: 200,
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': 'attachment; filename="brief.md"',
            'content-length': '14',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 })) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    const files = await api.listProjectArtifactFiles('project-1');
    await api.uploadProjectArtifactFiles('project-1', [
      {
        file_name: 'brief.md',
        description: 'Initial brief',
        content_base64: Buffer.from('# Brief').toString('base64'),
        content_type: 'text/markdown',
      },
    ]);
    const download = await api.downloadProjectArtifactFile('project-1', 'file-1');
    await api.deleteProjectArtifactFile('project-1', 'file-1');

    expect(files[0]?.key).toBe('brief-md');
    expect(download.file_name).toBe('brief.md');
    expect(download.content_type).toBe('text/markdown; charset=utf-8');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/files',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/files/batch',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/files/file-1/content',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/files/file-1',
    );
  });

  it('creates playbook workflows through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn().mockResolvedValue({ id: 'pipe-1' }),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const workflow = await api.createWorkflow({
      playbook_id: 'playbook-1',
      name: 'Test Run',
      budget: {
        token_budget: 120000,
        cost_cap_usd: 12.5,
        max_duration_minutes: 90,
      },
    });

    expect(client.createWorkflow).toHaveBeenCalledWith({
      playbook_id: 'playbook-1',
      name: 'Test Run',
      budget: {
        token_budget: 120000,
        cost_cap_usd: 12.5,
        max_duration_minutes: 90,
      },
    });
    expect(workflow).toEqual({ id: 'pipe-1' });
  });

  it('loads workflow budget through the dashboard api surface', async () => {
    writeSession({ accessToken: 'budget-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            tokens_used: 45000,
            tokens_limit: 120000,
            cost_usd: 6.25,
            cost_limit_usd: 12.5,
            elapsed_minutes: 42,
            duration_limit_minutes: 90,
            task_count: 6,
            orchestrator_activations: 4,
            tokens_remaining: 75000,
            cost_remaining_usd: 6.25,
            time_remaining_minutes: 48,
            warning_dimensions: ['cost'],
            exceeded_dimensions: [],
            warning_threshold_ratio: 0.8,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const budget = await api.getWorkflowBudget('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/budget',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer budget-token',
        }),
      }),
    );
    expect(budget.tokens_remaining).toBe(75000);
    expect(budget.warning_dimensions).toEqual(['cost']);
  });

  it('loads workflow events through the cursor-based workflow api surface', async () => {
    writeSession({ accessToken: 'events-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 42,
              type: 'workflow.activation_started',
              entity_type: 'workflow',
              entity_id: 'workflow-1',
              actor_type: 'orchestrator',
              actor_id: 'task-1',
              data: { workflow_id: 'workflow-1', activation_id: 'activation-1' },
              created_at: '2026-03-12T12:00:00.000Z',
            },
          ],
          meta: {
            has_more: true,
            next_after: 42,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const response = await api.listWorkflowEvents('workflow-1', {
      limit: '20',
      after: '100',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/events?limit=20&after=100',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer events-token',
        }),
      }),
    );
    expect(response).toEqual({
      data: [
        {
          id: 42,
          type: 'workflow.activation_started',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          actor_type: 'orchestrator',
          actor_id: 'task-1',
          data: { workflow_id: 'workflow-1', activation_id: 'activation-1' },
          created_at: '2026-03-12T12:00:00.000Z',
        },
      ],
      meta: {
        has_more: true,
        next_after: '42',
      },
    });
  });

  it('enqueues manual workflow activations through the dashboard api surface', async () => {
    writeSession({ accessToken: 'activation-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'activation-1',
            activation_id: 'activation-1',
            workflow_id: 'workflow-1',
            request_id: 'request-123',
            reason: 'Reassess board state',
            event_type: 'operator.manual_enqueue',
            payload: { source: 'workflow-detail-activations-card' },
            state: 'queued',
            queued_at: '2026-03-13T12:00:00.000Z',
          },
        }),
        { status: 201 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const activation = await api.enqueueWorkflowActivation('workflow-1', {
      reason: 'Reassess board state',
      payload: { source: 'workflow-detail-activations-card' },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/activations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer activation-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(
      JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}')),
    ).toEqual({
      request_id: 'request-123',
      reason: 'Reassess board state',
      event_type: 'operator.manual_enqueue',
      payload: { source: 'workflow-detail-activations-card' },
    });
    expect(activation.request_id).toBe('request-123');
    expect(activation.event_type).toBe('operator.manual_enqueue');
  });

  it('posts workflow cancellation with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'cancel-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'paused',
            metadata: { cancel_requested_at: '2026-03-13T12:00:00.000Z' },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.cancelWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(
      JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}')),
    ).toEqual({
      request_id: 'cancel-request-123',
    });
  });

  it('posts workflow pause with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'pause-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'paused',
            metadata: { pause_requested_at: '2026-03-13T12:00:00.000Z' },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.pauseWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/pause',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(
      JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}')),
    ).toEqual({
      request_id: 'pause-request-123',
    });
  });

  it('posts workflow resume with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'resume-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'active',
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.resumeWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/resume',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(
      JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}')),
    ).toEqual({
      request_id: 'resume-request-123',
    });
  });

  it('updates playbooks through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      updatePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-1', name: 'Delivery' }),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const playbook = await api.updatePlaybook('playbook-1', {
      name: 'Delivery',
      outcome: 'Ship work',
      definition: { lifecycle: 'continuous' },
    });

    expect(client.updatePlaybook).toHaveBeenCalledWith('playbook-1', {
      name: 'Delivery',
      outcome: 'Ship work',
      definition: { lifecycle: 'continuous' },
    });
    expect(playbook).toEqual({ id: 'playbook-1', name: 'Delivery' });
  });

  it('supports model override endpoints through typed dashboard methods', async () => {
    writeSession({ accessToken: 'model-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'project-1',
              name: 'Atlas',
              slug: 'atlas',
              settings: {
                model_overrides: {
                  architect: { provider: 'openai', model: 'gpt-5' },
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
              project_id: 'project-1',
              model_overrides: {
                architect: { provider: 'openai', model: 'gpt-5' },
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
              project_id: 'project-1',
              project_model_overrides: {
                architect: { provider: 'openai', model: 'gpt-5' },
              },
              effective_models: {
                architect: {
                  source: 'project',
                  fallback: false,
                  resolved: {
                    provider: { name: 'openai', providerType: 'openai' },
                    model: { modelId: 'gpt-5' },
                  },
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
              roles: ['architect'],
              project_model_overrides: {
                architect: { provider: 'openai', model: 'gpt-5' },
              },
              workflow_model_overrides: {
                architect: { provider: 'anthropic', model: 'claude-opus-4.1' },
              },
              effective_models: {
                architect: {
                  source: 'workflow',
                  fallback: false,
                  resolved: {
                    provider: { name: 'anthropic', providerType: 'anthropic' },
                    model: { modelId: 'claude-opus-4.1' },
                  },
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
              workflow_id: 'wf-1',
              model_overrides: {
                architect: { provider: 'anthropic', model: 'claude-opus-4.1' },
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
              workflow_id: 'wf-1',
              project_id: 'project-1',
              project_model_overrides: {
                architect: { provider: 'openai', model: 'gpt-5' },
              },
              workflow_model_overrides: {
                architect: { provider: 'anthropic', model: 'claude-opus-4.1' },
              },
              effective_models: {
                architect: {
                  source: 'workflow',
                  fallback: false,
                  resolved: {
                    provider: { name: 'anthropic', providerType: 'anthropic' },
                    model: { modelId: 'claude-opus-4.1' },
                  },
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    const patchedProject = await api.patchProject('project-1', {
      settings: {
        model_overrides: {
          architect: { provider: 'openai', model: 'gpt-5' },
        },
      },
    });
    const projectOverrides = await api.getProjectModelOverrides('project-1');
    const resolvedProject = await api.getResolvedProjectModels('project-1', ['architect']);
    const preview = await api.previewEffectiveModels({
      project_model_overrides: {
        architect: { provider: 'openai', model: 'gpt-5' },
      },
      workflow_model_overrides: {
        architect: { provider: 'anthropic', model: 'claude-opus-4.1' },
      },
    });
    const workflowOverrides = await api.getWorkflowModelOverrides('wf-1');
    const resolvedWorkflow = await api.getResolvedWorkflowModels('wf-1', ['architect']);

    expect(
      ((patchedProject.settings ?? {}) as { model_overrides?: Record<string, { model?: string }> })
        .model_overrides?.architect?.model,
    ).toBe('gpt-5');
    expect(projectOverrides.model_overrides.architect?.provider).toBe('openai');
    expect(resolvedProject.effective_models.architect?.source).toBe('project');
    expect(preview.effective_models.architect?.source).toBe('workflow');
    expect(workflowOverrides.model_overrides.architect?.provider).toBe('anthropic');
    expect(resolvedWorkflow.workflow_model_overrides.architect?.model).toBe('claude-opus-4.1');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/model-overrides',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/model-overrides/resolved?roles=architect',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/config/llm/resolve-preview',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/workflows/wf-1/model-overrides',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/workflows/wf-1/model-overrides/resolved?roles=architect',
    );
  });

  it('loads and updates workflow work items through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wi-1',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'normal',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wi-1',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'high',
              notes: 'Updated',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
    const workItem = await api.getWorkflowWorkItem('wf-1', 'wi-1');
    const updatedWorkItem = await api.updateWorkflowWorkItem('wf-1', 'wi-1', {
      priority: 'high',
      notes: 'Updated',
    });

    expect(workItem.id).toBe('wi-1');
    expect(updatedWorkItem.priority).toBe('high');
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/workflows/wf-1/work-items/wi-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/workflows/wf-1/work-items/wi-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('sends bearer token when loading metrics if an in-memory access token exists', async () => {
    writeSession({ accessToken: 'metrics-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

  it('loads the cost dashboard summary through the shared dashboard client contract', async () => {
    writeSession({ accessToken: 'cost-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
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
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
        new Response(JSON.stringify({ data: { id: 'pipe-1', lifecycle: 'standard', current_stage: 'build' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { workflow_id: 'pipe-1', resolved_config: { retries: 2 } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ workflow_id: 'pipe-1', kind: 'run_summary' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'artifact-1',
                workflow_id: 'pipe-1',
                task_id: 'task-1',
                logical_path: 'artifact:pipe-1/release-notes.md',
                content_type: 'text/markdown',
                size_bytes: 2048,
                created_at: '2026-03-12T08:00:00.000Z',
                download_url: '/api/v1/tasks/task-1/artifacts/artifact-1',
                metadata: {},
                workflow_name: 'Ship release',
                workflow_state: 'active',
                work_item_id: 'wi-1',
                work_item_title: 'Package release',
                stage_name: 'delivery',
                role: 'writer',
                task_title: 'Build release notes',
                task_state: 'completed',
                preview_eligible: true,
                preview_mode: 'text',
              },
            ],
            meta: {
              page: 1,
              per_page: 50,
              total: 1,
              total_pages: 1,
              has_more: false,
              summary: {
                total_artifacts: 1,
                previewable_artifacts: 1,
                total_bytes: 2048,
                workflow_count: 1,
                work_item_count: 1,
                task_count: 1,
                role_count: 1,
              },
              filters: {
                workflows: [{ id: 'pipe-1', name: 'Ship release' }],
                work_items: [{ id: 'wi-1', title: 'Package release', workflow_id: 'pipe-1', stage_name: 'delivery' }],
                tasks: [{ id: 'task-1', title: 'Build release notes', workflow_id: 'pipe-1', work_item_id: 'wi-1', stage_name: 'delivery' }],
                stages: ['delivery'],
                roles: ['writer'],
                content_types: ['text/markdown'],
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    await api.actOnStageGate('pipe-1', 'build', { action: 'approve' });
    const config = await api.getResolvedWorkflowConfig('pipe-1', true);
    const timeline = await api.getProjectTimeline('project-1');
    const artifacts = await api.listProjectArtifacts('project-1', {
      q: 'release',
      preview_mode: 'inline',
      page: '1',
      per_page: '50',
    });

    expect(config.resolved_config).toEqual({ retries: 2 });
    expect(timeline[0].kind).toBe('run_summary');
    expect(artifacts.data[0]?.id).toBe('artifact-1');
    expect(artifacts.meta.summary.total_artifacts).toBe(1);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/stages/build/gate',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/config/resolved?show_layers=true',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/timeline',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/artifacts?q=release&preview_mode=inline&page=1&per_page=50',
    );
  });

  it('lists projects and starts a planning workflow through typed dashboard methods', async () => {
    writeSession({ accessToken: 'planning-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'project-1',
                name: 'Alpha',
                slug: 'alpha',
                summary: {
                  active_workflow_count: 1,
                  completed_workflow_count: 3,
                  attention_workflow_count: 2,
                },
              },
            ],
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
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
    const planning = await api.createPlanningWorkflow('project-1', {
      brief: 'Plan the next workflow increment.',
      name: 'AI Planning',
    });

    expect(projects.data[0].id).toBe('project-1');
    expect(projects.data[0].summary).toEqual({
      active_workflow_count: 1,
      completed_workflow_count: 3,
      attention_workflow_count: 2,
    });
    expect((planning as { data?: { id?: string } }).data?.id).toBe('pipe-9');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/projects?per_page=50',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/planning-workflow',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              entries: [
                {
                  key: 'summary',
                  value: { ok: true },
                  event_id: 12,
                  updated_at: '2026-03-07T00:00:00.000Z',
                  actor_type: 'agent',
                  actor_id: 'agent-1',
                  workflow_id: 'pipe-1',
                  work_item_id: 'wi-1',
                  task_id: 'task-1',
                  stage_name: 'design',
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
              history: [
                {
                  key: 'summary',
                  value: { ok: true },
                  event_id: 13,
                  event_type: 'updated',
                  updated_at: '2026-03-08T00:00:00.000Z',
                  actor_type: 'agent',
                  actor_id: 'agent-1',
                  workflow_id: 'pipe-1',
                  work_item_id: 'wi-1',
                  task_id: 'task-1',
                  stage_name: 'design',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('# Summary\n\nSafe content', {
          status: 200,
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': 'attachment; filename="summary.md"',
            'content-length': '23',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('artifact-bytes', {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="bundle.zip"',
            'content-length': '14',
          },
        }),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
    const documents = await api.listWorkflowDocuments('pipe-1');
    const artifacts = await api.listTaskArtifacts('task-1');
    const workItemMemory = await api.getWorkflowWorkItemMemory('pipe-1', 'wi-1');
    const workItemMemoryHistory = await api.getWorkflowWorkItemMemoryHistory('pipe-1', 'wi-1');
    const artifactContent = await api.readTaskArtifactContent('task-1', 'artifact-1');
    const artifactDownload = await api.downloadTaskArtifact('task-1', 'artifact-1');

    expect(project.memory?.last_run_summary).toEqual({ kind: 'run_summary' });
    expect(updated.memory?.operator_note).toEqual({ summary: 'check rollout' });
    expect(documents[0].logical_name).toBe('project_brief');
    expect(artifacts[0].id).toBe('artifact-1');
    expect(workItemMemory.entries[0]?.key).toBe('summary');
    expect(workItemMemoryHistory.history[0]?.event_type).toBe('updated');
    expect(artifactContent.file_name).toBe('summary.md');
    expect(artifactContent.content_type).toBe('text/markdown; charset=utf-8');
    expect(artifactDownload.file_name).toBe('bundle.zip');
    expect(artifactDownload.content_type).toBe('application/octet-stream');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/projects/project-1/memory',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/work-items/wi-1/memory',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/work-items/wi-1/memory/history?limit=100',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts/artifact-1',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts/artifact-1',
    );
  });

  it('manages scheduled and webhook trigger surfaces through typed dashboard methods', async () => {
    writeSession({ accessToken: 'trigger-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'sched-1',
                name: 'Daily triage',
                source: 'project.schedule',
                project_id: 'project-1',
                workflow_id: 'wf-1',
                schedule_type: 'interval',
                cadence_minutes: 60,
                daily_time: null,
                timezone: null,
                defaults: { title: 'Run triage' },
                is_active: true,
                next_fire_at: '2026-03-12T08:00:00.000Z',
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
              id: 'sched-2',
              name: 'Hourly sweep',
              source: 'project.schedule',
              project_id: 'project-1',
              workflow_id: 'wf-1',
              schedule_type: 'interval',
              cadence_minutes: 30,
              daily_time: null,
              timezone: null,
              defaults: { title: 'Sweep' },
              is_active: true,
              next_fire_at: '2026-03-12T09:00:00.000Z',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'sched-2',
              name: 'Hourly sweep',
              source: 'project.schedule',
              project_id: 'project-1',
              workflow_id: 'wf-1',
              schedule_type: 'interval',
              cadence_minutes: 30,
              daily_time: null,
              timezone: null,
              defaults: { title: 'Sweep' },
              is_active: false,
              next_fire_at: '2026-03-12T09:00:00.000Z',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'hook-1',
                name: 'GitHub PR',
                source: 'github',
                project_id: 'project-1',
                workflow_id: 'wf-1',
                signature_header: 'X-Signature',
                signature_mode: 'hmac_sha256',
                is_active: true,
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
              id: 'hook-2',
              name: 'GitLab MR',
              source: 'gitlab',
              project_id: 'project-1',
              workflow_id: 'wf-1',
              signature_header: 'X-Signature',
              signature_mode: 'shared_secret',
              is_active: true,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'hook-2',
              name: 'GitLab MR',
              source: 'gitlab',
              project_id: 'project-1',
              workflow_id: 'wf-1',
              signature_header: 'X-Signature',
              signature_mode: 'shared_secret',
              is_active: false,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }));
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    const scheduled = await api.listScheduledWorkItemTriggers();
    const createdScheduled = await api.createScheduledWorkItemTrigger({
      name: 'Hourly sweep',
      source: 'project.schedule',
      workflow_id: 'wf-1',
      cadence_minutes: 30,
      defaults: { title: 'Sweep' },
    });
    const updatedScheduled = await api.updateScheduledWorkItemTrigger('sched-2', {
      is_active: false,
    });
    await api.deleteScheduledWorkItemTrigger('sched-2');

    const webhooks = await api.listWebhookWorkItemTriggers();
    const createdWebhook = await api.createWebhookWorkItemTrigger({
      name: 'GitLab MR',
      source: 'gitlab',
      workflow_id: 'wf-1',
      signature_header: 'X-Signature',
      signature_mode: 'shared_secret',
      secret: 'supersecret',
    });
    const updatedWebhook = await api.updateWebhookWorkItemTrigger('hook-2', {
      is_active: false,
    });
    await api.deleteWebhookWorkItemTrigger('hook-2');

    expect(scheduled.data[0]?.id).toBe('sched-1');
    expect(createdScheduled.id).toBe('sched-2');
    expect(updatedScheduled.is_active).toBe(false);
    expect(webhooks.data[0]?.id).toBe('hook-1');
    expect(createdWebhook.id).toBe('hook-2');
    expect(updatedWebhook.is_active).toBe(false);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/scheduled-work-item-triggers',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/scheduled-work-item-triggers/sched-2',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/work-item-triggers',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/work-item-triggers/hook-2',
    );
  });

  it('manages workflow documents and task artifacts through typed dashboard mutations', async () => {
    writeSession({ accessToken: 'content-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              logical_name: 'project_brief',
              scope: 'workflow',
              source: 'repository',
              title: 'Project Brief',
              description: 'Primary brief',
              metadata: { audience: 'operator' },
              repository: 'org/repo',
              path: 'docs/brief.md',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              logical_name: 'project_brief',
              scope: 'workflow',
              source: 'external',
              title: 'Project Brief',
              description: 'Updated brief',
              metadata: { audience: 'operator' },
              url: 'https://example.com/brief',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'artifact-2',
              task_id: 'task-1',
              logical_path: 'artifact:task-1/report.md',
              content_type: 'text/markdown',
              size_bytes: 128,
              checksum_sha256: 'abc',
              metadata: { source: 'smoke' },
              retention_policy: {},
              created_at: '2026-03-12T00:00:00.000Z',
              download_url: '/api/v1/tasks/task-1/artifacts/artifact-2',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    const createdDocument = await api.createWorkflowDocument('pipe-1', {
      logical_name: 'project_brief',
      source: 'repository',
      repository: 'org/repo',
      path: 'docs/brief.md',
      metadata: { audience: 'operator' },
    });
    const updatedDocument = await api.updateWorkflowDocument('pipe-1', 'project_brief', {
      source: 'external',
      url: 'https://example.com/brief',
      description: 'Updated brief',
    });
    await api.deleteWorkflowDocument('pipe-1', 'project_brief');
    const uploadedArtifact = await api.uploadTaskArtifact('task-1', {
      path: 'artifact:task-1/report.md',
      content_base64: 'Ym9keQ==',
      content_type: 'text/markdown',
      metadata: { source: 'smoke' },
    });
    await api.deleteTaskArtifact('task-1', 'artifact-2');

    expect(createdDocument.logical_name).toBe('project_brief');
    expect(updatedDocument.source).toBe('external');
    expect(uploadedArtifact.id).toBe('artifact-2');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents/project_brief',
    );
    expect(String(vi.mocked(fetcher).mock.calls[2][0])).toMatch(
      /^http:\/\/localhost:8080\/api\/v1\/workflows\/pipe-1\/documents\/project_brief\?request_id=/,
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/tasks/task-1/artifacts/artifact-2',
    );
    expect(vi.mocked(fetcher).mock.calls[0][1]?.method).toBe('POST');
    expect(vi.mocked(fetcher).mock.calls[1][1]?.method).toBe('PATCH');
    expect(vi.mocked(fetcher).mock.calls[2][1]?.method).toBe('DELETE');
    expect(vi.mocked(fetcher).mock.calls[3][1]?.method).toBe('POST');
    expect(vi.mocked(fetcher).mock.calls[4][1]?.method).toBe('DELETE');
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: {} }), { status: 200 }),
      );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    const status = await api.fetchFleetStatus();
    const workers = await api.fetchFleetWorkers();
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
    expect(created.pool_kind).toBe('specialist');
    expect(updated.llm_api_key_secret_ref_configured).toBe(true);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/fleet/status',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2/restart',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2/drain',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/fleet/workers/worker-2',
    );
  });

  it('uses persisted platform instruction endpoints for current state, versions, restore, and clear', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 3, content: '# Current', format: 'markdown' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'ver-2', version: 2, content: '# Older', format: 'markdown' }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 4, content: '# Restored', format: 'markdown' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 5, content: '', format: 'text' },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    await expect(api.getPlatformInstructions()).resolves.toMatchObject({ version: 3 });
    await expect(api.listPlatformInstructionVersions()).resolves.toMatchObject([
      { version: 2 },
    ]);
    await expect(
      api.updatePlatformInstructions({ content: '# Restored', format: 'markdown' }),
    ).resolves.toMatchObject({ version: 4 });
    await expect(api.clearPlatformInstructions()).resolves.toMatchObject({
      version: 5,
      content: '',
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({ Authorization: 'Bearer api-token' }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/platform/instructions/versions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    );
  });

  it('updates project spec through the dashboard api surface', async () => {
    writeSession({ accessToken: 'spec-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              project_id: 'project-1',
              version: 4,
              spec: {
                config: { repository: 'agirunner/agirunner-test-fixtures' },
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    await expect(
      api.updateProjectSpec('project-1', {
        config: { repository: 'agirunner/agirunner-test-fixtures' },
      }),
    ).resolves.toMatchObject({ version: 4 });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/projects/project-1/spec',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
      }),
    );
  });

  it('unwraps project spec envelopes when reading the dashboard api surface', async () => {
    writeSession({ accessToken: 'spec-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              project_id: 'project-1',
              version: 5,
              created_at: '2026-03-14T19:00:00.000Z',
              spec: {
                config: { repository: 'agirunner/agirunner-test-fixtures' },
                instructions: { summary: 'Keep the checkout steady.' },
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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

    await expect(api.getProjectSpec('project-1')).resolves.toEqual({
      project_id: 'project-1',
      version: 5,
      created_at: '2026-03-14T19:00:00.000Z',
      created_by_id: undefined,
      created_by_type: undefined,
      config: { repository: 'agirunner/agirunner-test-fixtures' },
      instructions: { summary: 'Keep the checkout steady.' },
      resources: undefined,
      documents: undefined,
      tools: undefined,
    });
  });
});

describe('dashboard global search', () => {
  it('buildSearchResults creates task, workflow, project, playbook, worker, and agent route targets', () => {
    const results = buildSearchResults('build', {
      workflows: [{ id: 'workflow-1', name: 'Build Workflow', state: 'running' }],
      tasks: [{ id: 'task-1', title: 'Build artifact', state: 'ready' }],
      projects: [{ id: 'project-1', name: 'Build Project' }],
      playbooks: [{ id: 'playbook-1', name: 'Build Playbook' }],
      workers: [{ id: 'worker-1', name: 'Builder worker', status: 'online' }],
      agents: [{ id: 'agent-1', name: 'Builder agent', status: 'idle' }],
    });

    expect(results.map((result) => result.type)).toEqual([
      'workflow',
      'task',
      'project',
      'playbook',
      'worker',
      'agent',
    ]);
    expect(results[0].href).toBe('/work/boards/workflow-1');
    expect(results[1].href).toBe('/work/tasks/task-1');
    expect(results[2].href).toBe('/projects/project-1');
    expect(results[3].href).toBe('/config/playbooks/playbook-1');
    expect(results[4].href).toBe('/fleet/workers');
    expect(results[5].href).toBe('/fleet/agents');
  });

  it('search() merges matches from all dashboard resources', async () => {
    writeSession({ accessToken: 'token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      listWorkflows: vi.fn().mockResolvedValue({
        data: [{ id: 'workflow-1', name: 'Test Workflow', state: 'running' }],
      }),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
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
      listProjects: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'project-1', name: 'Test project' }] }),
      listPlaybooks: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'playbook-1', name: 'Test playbook' }] }),
    };
    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const results = await api.search('test');

    expect(results).toHaveLength(6);
    expect(client.listWorkflows).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listTasks).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listProjects).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listPlaybooks).toHaveBeenCalled();
  });

  it('deletes a project through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deleteProject('project-42');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/projects/project-42',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('asks the config assistant through the shared api client', async () => {
    writeSession({ accessToken: 'assistant-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            reply: 'Your runtime defaults look good.',
            suggestions: [
              {
                path: 'runtime.timeout',
                current_value: '300',
                suggested_value: '600',
                description: 'Increase timeout for long-running tasks',
              },
            ],
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const result = await api.askConfigAssistant('Review my runtime defaults');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/config/assistant',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer assistant-token',
        }),
        body: JSON.stringify({ question: 'Review my runtime defaults' }),
      }),
    );
    expect(result.reply).toBe('Your runtime defaults look good.');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions![0].path).toBe('runtime.timeout');
  });
});
