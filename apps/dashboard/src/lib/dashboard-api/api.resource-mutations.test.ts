import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './index.js';
import { resetDashboardApiTestEnvironment } from './test-support/create-dashboard-api.js';
import { writeSession } from '../auth/session.js';

describe('dashboard api resource mutations', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
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
});
