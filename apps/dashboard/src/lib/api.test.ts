import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './api.js';
import { resetDashboardApiTestEnvironment } from './dashboard-api/create-dashboard-api.test-support.js';
import { readApiSource, readExportBlock } from './dashboard-api/contracts.source-test-support.js';
import { clearSession, readSession, writeSession } from './session.js';

describe('dashboard api auth/session behavior', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('routes workflow-linked escalation resolution through the workflow work-item operator flow', async () => {
    writeSession({ accessToken: 'token-1', tenantId: 'tenant-1' });

    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'task-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      baseUrl: 'http://platform.test',
      client: client as never,
      fetcher,
    });

    await api.resolveTaskEscalation(
      'task-1',
      { instructions: 'Resume with captured operator guidance.' },
      { workflowId: 'workflow-1', workItemId: 'wi-1' },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://platform.test/api/v1/workflows/workflow-1/work-items/wi-1/tasks/task-1/resolve-escalation',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('keeps standalone escalation resolution on the raw task endpoint', async () => {
    writeSession({ accessToken: 'token-1', tenantId: 'tenant-1' });

    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'task-standalone-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      baseUrl: 'http://platform.test',
      client: client as never,
      fetcher,
    });

    await api.resolveTaskEscalation('task-standalone-1', {
      instructions: 'Continue using the standalone task flow.',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://platform.test/api/v1/tasks/task-standalone-1/resolve-escalation',
      expect.objectContaining({
        method: 'POST',
      }),
    );
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
    expect(readSession()).toEqual({
      accessToken: 'fresh-token',
      tenantId: 'tenant-1',
      persistentSession: false,
    });
  });

  it('requests mission control live, recent, history, and workflow workspace read models from the platform api', async () => {
    writeSession({ accessToken: 'mc-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:00:00.000Z',
                latestEventId: 10,
                token: 'live-token',
              },
              sections: [],
              attentionItems: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:01:00.000Z',
                latestEventId: 11,
                token: 'recent-token',
              },
              packets: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:02:00.000Z',
                latestEventId: 12,
                token: 'history-token',
              },
              packets: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              version: {
                generatedAt: '2026-03-27T18:03:00.000Z',
                latestEventId: 13,
                token: 'workspace-token',
              },
              workflow: null,
              overview: null,
              board: null,
              outputs: {
                deliverables: [],
                feed: [],
              },
              steering: {
                availableActions: [],
                interventionHistory: [],
              },
              history: {
                packets: [],
              },
            },
          }),
          { status: 200 },
        ),
      );

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.getMissionControlLive({ page: 2, perPage: 25 });
    await api.getMissionControlRecent({ limit: 15 });
    await api.getMissionControlHistory({ workflowId: 'workflow-1', limit: 20 });
    await api.getMissionControlWorkflowWorkspace('workflow-1', {
      historyLimit: 12,
      outputLimit: 4,
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/operations/workflows?mode=live&page=2&per_page=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer mc-token',
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/operations/workflows?mode=recent&limit=15',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/operations/workflows?mode=history&workflow_id=workflow-1&limit=20',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v1/operations/workflows/workflow-1/workspace?history_limit=12&output_limit=4',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
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

  it('persists tenant bootstrap in localStorage and keeps the access token session-scoped by default', async () => {
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

    expect(readSession()).toEqual({
      accessToken: 'ephemeral-token',
      tenantId: 'tenant-1',
      persistentSession: true,
    });
    expect(sessionStorage.getItem('agirunner.tenantId')).toBeNull();
    expect(localStorage.getItem('agirunner.tenantId')).toBe('tenant-1');
    expect(localStorage.getItem('agirunner.accessToken')).toBeNull();
    expect(sessionStorage.getItem('agirunner.accessToken')).toBe('ephemeral-token');
  });

  it('keeps tenant bootstrap in sessionStorage when persistent login is disabled', async () => {
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
    await api.login('ar_admin_test_key', false);

    expect(readSession()).toEqual({
      accessToken: 'ephemeral-token',
      tenantId: 'tenant-1',
      persistentSession: false,
    });
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

  it('treats 204 no-content deletes as success for remote MCP servers', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.deleteRemoteMcpServer('mcp-1')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/remote-mcp-servers/mcp-1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-token',
        }),
      }),
    );
  });

  it('deletes workspace memory entries through the dedicated workspace-memory delete route', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'workspace-1', memory: {} } }), { status: 200 }),
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

    await api.removeWorkspaceMemory('workspace-1', 'operator_note');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-1/memory/operator_note',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-token',
        }),
      }),
    );
  });

  it('manages workspace-owned artifact files through dedicated workspace file routes', async () => {
    writeSession({ accessToken: 'artifact-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi
      .mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'file-1',
                workspace_id: 'workspace-1',
                key: 'brief-md',
                description: 'Initial brief',
                file_name: 'brief.md',
                content_type: 'text/markdown',
                size_bytes: 128,
                created_at: '2026-03-14T18:00:00.000Z',
                download_url: '/api/v1/workspaces/workspace-1/files/file-1/content',
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
                workspace_id: 'workspace-1',
                key: 'brief-md',
                description: 'Initial brief',
                file_name: 'brief.md',
                content_type: 'text/markdown',
                size_bytes: 128,
                created_at: '2026-03-14T18:00:00.000Z',
                download_url: '/api/v1/workspaces/workspace-1/files/file-1/content',
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

    const files = await api.listWorkspaceArtifactFiles('workspace-1');
    await api.uploadWorkspaceArtifactFiles('workspace-1', [
      {
        file_name: 'brief.md',
        description: 'Initial brief',
        content_base64: Buffer.from('# Brief').toString('base64'),
        content_type: 'text/markdown',
      },
    ]);
    const download = await api.downloadWorkspaceArtifactFile('workspace-1', 'file-1');
    await api.deleteWorkspaceArtifactFile('workspace-1', 'file-1');

    expect(files[0]?.key).toBe('brief-md');
    expect(download.file_name).toBe('brief.md');
    expect(download.content_type).toBe('text/markdown; charset=utf-8');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files/batch',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files/file-1/content',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/files/file-1',
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
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
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
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
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
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
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
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
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
      definition: { lifecycle: 'ongoing' },
    });

    expect(client.updatePlaybook).toHaveBeenCalledWith('playbook-1', {
      name: 'Delivery',
      outcome: 'Ship work',
      definition: { lifecycle: 'ongoing' },
    });
    expect(playbook).toEqual({ id: 'playbook-1', name: 'Delivery' });
  });

  it('does not expose retired workspace or workflow model override endpoints through the dashboard api surface', () => {
    const source = readApiSource();
    const dashboardApiBlock = readExportBlock(source, 'DashboardApi');
    const createWorkflowBlock = source.slice(
      source.indexOf('createWorkflow(payload: {'),
      source.indexOf('\n  createWorkflowWorkItem(', source.indexOf('createWorkflow(payload: {')),
    );

    expect(dashboardApiBlock).not.toContain('getWorkspaceModelOverrides(');
    expect(dashboardApiBlock).not.toContain('getResolvedWorkspaceModels(');
    expect(dashboardApiBlock).not.toContain('getWorkflowModelOverrides(');
    expect(dashboardApiBlock).not.toContain('getResolvedWorkflowModels(');
    expect(dashboardApiBlock).not.toContain('previewEffectiveModels(');
    expect(dashboardApiBlock).not.toContain('getResolvedWorkflowConfig(');
    expect(createWorkflowBlock).not.toContain(
      'model_overrides?: Record<string, DashboardRoleModelOverride>;',
    );
    expect(source).not.toContain('/api/v1/workspaces/${workspaceId}/model-overrides');
    expect(source).not.toContain('/api/v1/workflows/${workflowId}/model-overrides');
    expect(source).not.toContain('/api/v1/config/llm/resolve-preview');
    expect(source).not.toContain('/api/v1/workflows/${workflowId}/config/resolved');
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


  it('uses workflow operator record endpoints for mission control launch, steering, and redrive actions', async () => {
    writeSession({ accessToken: 'operator-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi
      .mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'packet-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                packet_kind: 'launch',
                source: 'operator',
                summary: 'Launch files',
                structured_inputs: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
                files: [],
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
              id: 'packet-2',
              workflow_id: 'workflow-1',
              work_item_id: null,
              packet_kind: 'launch',
              source: 'operator',
              summary: 'Launch files',
              structured_inputs: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
              files: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'intervention-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                task_id: null,
                kind: 'steering_instruction',
                origin: 'mission_control',
                status: 'recorded',
                summary: 'Focus on verification',
                note: null,
                structured_action: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
                files: [],
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
              id: 'intervention-2',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              kind: 'steering_instruction',
              origin: 'mission_control',
              status: 'recorded',
              summary: 'Focus on verification',
              note: null,
              structured_action: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
              files: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'session-1',
                workflow_id: 'workflow-1',
                title: 'Operator steering',
                status: 'active',
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
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
              id: 'session-2',
              workflow_id: 'workflow-1',
              title: 'Operator steering',
              status: 'active',
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'message-1',
                workflow_id: 'workflow-1',
                steering_session_id: 'session-1',
                role: 'operator',
                content: 'Focus on verification',
                structured_proposal: {},
                intervention_id: null,
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
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
              id: 'message-2',
              workflow_id: 'workflow-1',
              steering_session_id: 'session-1',
              role: 'operator',
              content: 'Focus on verification',
              structured_proposal: {},
              intervention_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              source_workflow_id: 'workflow-1',
              attempt_number: 2,
              workflow: {
                id: 'workflow-2',
                name: 'Release retry',
              },
              input_packet: null,
            },
          }),
          { status: 201 },
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

    const packets = await api.listWorkflowInputPackets('workflow-1');
    const createdPacket = await api.createWorkflowInputPacket('workflow-1', {
      packet_kind: 'launch',
      summary: 'Launch files',
      files: [],
    });
    const interventions = await api.listWorkflowInterventions('workflow-1');
    const createdIntervention = await api.createWorkflowIntervention('workflow-1', {
      kind: 'steering_instruction',
      summary: 'Focus on verification',
    });
    const sessions = await api.listWorkflowSteeringSessions('workflow-1');
    const createdSession = await api.createWorkflowSteeringSession('workflow-1', {
      title: 'Operator steering',
    });
    const messages = await api.listWorkflowSteeringMessages('workflow-1', 'session-1');
    const appendedMessage = await api.appendWorkflowSteeringMessage('workflow-1', 'session-1', {
      content: 'Focus on verification',
    });
    const redrive = await api.redriveWorkflow('workflow-1', {
      request_id: 'request-1',
      name: 'Release retry',
      summary: 'Retry with corrected inputs',
    });

    expect(packets[0].id).toBe('packet-1');
    expect(createdPacket.id).toBe('packet-2');
    expect(interventions[0].id).toBe('intervention-1');
    expect(createdIntervention.id).toBe('intervention-2');
    expect(sessions[0].id).toBe('session-1');
    expect(createdSession.id).toBe('session-2');
    expect(messages[0].id).toBe('message-1');
    expect(appendedMessage.id).toBe('message-2');
    expect(redrive.workflow.id).toBe('workflow-2');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/input-packets',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/input-packets',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/interventions',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/interventions',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions/session-1/messages',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions/session-1/messages',
    );
    expect(vi.mocked(fetcher).mock.calls[8][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/redrives',
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
    await expect(api.listPlatformInstructionVersions()).resolves.toMatchObject([{ version: 2 }]);
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

});

describe('dashboard global search', () => {
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
      listWorkspaces: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'workspace-1', name: 'Test workspace' }] }),
      listPlaybooks: vi
        .fn()
        .mockResolvedValue({ data: [{ id: 'playbook-1', name: 'Test playbook' }] }),
    };
    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const results = await api.search('test');

    expect(results).toHaveLength(5);
    expect(client.listWorkflows).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listTasks).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listWorkspaces).toHaveBeenCalledWith({ per_page: 50 });
    expect(client.listPlaybooks).toHaveBeenCalled();
  });

  it('deletes a workspace through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deleteWorkspace('workspace-42');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('loads workspace delete impact through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workflows: 3,
            active_workflows: 1,
            tasks: 8,
            active_tasks: 2,
            work_items: 4,
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

    await expect(api.getWorkspaceDeleteImpact('workspace-42')).resolves.toEqual({
      workflows: 3,
      active_workflows: 1,
      tasks: 8,
      active_tasks: 2,
      work_items: 4,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42/delete-impact',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('deletes a workspace with cascade enabled through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deleteWorkspace('workspace-42', { cascade: true });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-42?cascade=true',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('loads playbook delete impact through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            revision: {
              workflows: 1,
              active_workflows: 0,
              tasks: 2,
              active_tasks: 0,
              work_items: 1,
            },
            family: {
              revisions: 4,
              workflows: 7,
              active_workflows: 2,
              tasks: 18,
              active_tasks: 4,
              work_items: 9,
            },
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

    await expect(api.getPlaybookDeleteImpact('playbook-42')).resolves.toEqual({
      revision: {
        workflows: 1,
        active_workflows: 0,
        tasks: 2,
        active_tasks: 0,
        work_items: 1,
      },
      family: {
        revisions: 4,
        workflows: 7,
        active_workflows: 2,
        tasks: 18,
        active_tasks: 4,
        work_items: 9,
      },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/playbooks/playbook-42/delete-impact',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });

  it('deletes a playbook family permanently through the shared api client', async () => {
    writeSession({ accessToken: 'delete-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.deletePlaybookPermanently('playbook-42');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/playbooks/playbook-42/permanent',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer delete-token',
        }),
      }),
    );
  });
});
