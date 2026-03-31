import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from '../api.js';
import { writeSession } from '../session.js';

import {
  createDashboardApiClientStub,
  resetDashboardApiTestEnvironment,
} from './create-dashboard-api.test-support.js';

describe('dashboard api content surfaces', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('loads content and memory surfaces through typed dashboard methods', async () => {
    writeSession({ accessToken: 'content-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'workspace-1',
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
              id: 'workspace-1',
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
                logical_name: 'workspace_brief',
                scope: 'workspace',
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
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const workspace = await api.getWorkspace('workspace-1');
    const updated = await api.patchWorkspaceMemory('workspace-1', {
      key: 'operator_note',
      value: { summary: 'check rollout' },
    });
    const documents = await api.listWorkflowDocuments('pipe-1');
    const artifacts = await api.listTaskArtifacts('task-1');
    const workItemMemory = await api.getWorkflowWorkItemMemory('pipe-1', 'wi-1');
    const workItemMemoryHistory = await api.getWorkflowWorkItemMemoryHistory('pipe-1', 'wi-1');
    const artifactContent = await api.readTaskArtifactContent('task-1', 'artifact-1');
    const artifactDownload = await api.downloadTaskArtifact('task-1', 'artifact-1');

    expect(workspace.memory?.last_run_summary).toEqual({ kind: 'run_summary' });
    expect(updated.memory?.operator_note).toEqual({ summary: 'check rollout' });
    expect(documents[0].logical_name).toBe('workspace_brief');
    expect(artifacts[0].id).toBe('artifact-1');
    expect(workItemMemory.entries[0]?.key).toBe('summary');
    expect(workItemMemoryHistory.history[0]?.event_type).toBe('updated');
    expect(artifactContent.file_name).toBe('summary.md');
    expect(artifactContent.content_type).toBe('text/markdown; charset=utf-8');
    expect(artifactDownload.file_name).toBe('bundle.zip');
    expect(artifactDownload.content_type).toBe('application/octet-stream');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workspaces/workspace-1/memory',
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

  it('manages workflow documents and task artifacts through typed dashboard mutations', async () => {
    writeSession({ accessToken: 'content-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              logical_name: 'workspace_brief',
              scope: 'workflow',
              source: 'repository',
              title: 'Workspace Brief',
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
              logical_name: 'workspace_brief',
              scope: 'workflow',
              source: 'external',
              title: 'Workspace Brief',
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
    const api = createDashboardApi({
      client: createDashboardApiClientStub() as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const createdDocument = await api.createWorkflowDocument('pipe-1', {
      logical_name: 'workspace_brief',
      source: 'repository',
      repository: 'org/repo',
      path: 'docs/brief.md',
      metadata: { audience: 'operator' },
    });
    const updatedDocument = await api.updateWorkflowDocument('pipe-1', 'workspace_brief', {
      source: 'external',
      url: 'https://example.com/brief',
      description: 'Updated brief',
    });
    await api.deleteWorkflowDocument('pipe-1', 'workspace_brief');
    const uploadedArtifact = await api.uploadTaskArtifact('task-1', {
      path: 'artifact:task-1/report.md',
      content_base64: 'Ym9keQ==',
      content_type: 'text/markdown',
      metadata: { source: 'smoke' },
    });
    await api.deleteTaskArtifact('task-1', 'artifact-2');

    expect(createdDocument.logical_name).toBe('workspace_brief');
    expect(updatedDocument.source).toBe('external');
    expect(uploadedArtifact.id).toBe('artifact-2');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workflows/pipe-1/documents/workspace_brief',
    );
    expect(String(vi.mocked(fetcher).mock.calls[2][0])).toMatch(
      /^http:\/\/localhost:8080\/api\/v1\/workflows\/pipe-1\/documents\/workspace_brief\?request_id=/,
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
});
