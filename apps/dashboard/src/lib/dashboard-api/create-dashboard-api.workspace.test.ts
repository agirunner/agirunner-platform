import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from '../api.js';
import { writeSession } from '../auth/session.js';

import {
  createDashboardApiClientStub,
  resetDashboardApiTestEnvironment,
} from './test-support/create-dashboard-api.js';

describe('dashboard api workspace surfaces', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('verifies workspace git access through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            ok: true,
            repository_url: 'https://github.com/example/private-repo.git',
            default_branch: 'main',
            branch_verified: true,
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

    const result = await api.verifyWorkspaceGitAccess('workspace-1', {
      repository_url: 'https://github.com/example/private-repo.git',
      default_branch: 'main',
      git_token_mode: 'preserve',
    });

    expect(result).toEqual({
      ok: true,
      repository_url: 'https://github.com/example/private-repo.git',
      default_branch: 'main',
      branch_verified: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-1/verify-git-access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repository_url: 'https://github.com/example/private-repo.git',
          default_branch: 'main',
          git_token_mode: 'preserve',
        }),
      }),
    );
  });

  it('calls workflow cockpit endpoints with typed dashboard methods', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
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
                work_items: [
                  {
                    id: 'wi-1',
                    title: 'Package release',
                    workflow_id: 'pipe-1',
                    stage_name: 'delivery',
                  },
                ],
                tasks: [
                  {
                    id: 'task-1',
                    title: 'Build release notes',
                    workflow_id: 'pipe-1',
                    work_item_id: 'wi-1',
                    stage_name: 'delivery',
                  },
                ],
                stages: ['delivery'],
                roles: ['writer'],
                content_types: ['text/markdown'],
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

    const timeline = await api.getWorkspaceTimeline('workspace-1');
    const artifacts = await api.listWorkspaceArtifacts('workspace-1', {
      q: 'release',
      preview_mode: 'inline',
      page: '1',
      per_page: '50',
    });

    expect(timeline[0].kind).toBe('run_summary');
    expect(artifacts.data[0]?.id).toBe('artifact-1');
    expect(artifacts.meta.summary.total_artifacts).toBe(1);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/timeline',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/artifacts?q=release&preview_mode=inline&page=1&per_page=50',
    );
  });

  it('lists workspaces and starts a planning workflow through typed dashboard methods', async () => {
    writeSession({ accessToken: 'planning-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'workspace-1',
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
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const workspaces = await api.listWorkspaces();
    const planning = await api.createPlanningWorkflow('workspace-1', {
      brief: 'Plan the next workflow increment.',
      name: 'AI Planning',
    });

    expect(workspaces.data[0].id).toBe('workspace-1');
    expect(workspaces.data[0].summary).toEqual({
      active_workflow_count: 1,
      completed_workflow_count: 3,
      attention_workflow_count: 2,
    });
    expect((planning as { data?: { id?: string } }).data?.id).toBe('pipe-9');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workspaces?per_page=50',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/planning-workflow',
    );
  });

  it('updates workspace spec through the dashboard api surface', async () => {
    writeSession({ accessToken: 'spec-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workspace_id: 'workspace-1',
            version: 4,
            spec: {
              config: { repository: 'agirunner/agirunner-test-fixtures' },
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

    await expect(
      api.updateWorkspaceSpec('workspace-1', {
        config: { repository: 'agirunner/agirunner-test-fixtures' },
      }),
    ).resolves.toMatchObject({ version: 4 });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workspaces/workspace-1/spec',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
      }),
    );
  });

  it('unwraps workspace spec envelopes when reading the dashboard api surface', async () => {
    writeSession({ accessToken: 'spec-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            workspace_id: 'workspace-1',
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
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await expect(api.getWorkspaceSpec('workspace-1')).resolves.toEqual({
      workspace_id: 'workspace-1',
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
