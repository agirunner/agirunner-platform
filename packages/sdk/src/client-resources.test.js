import { describe, expect, it, vi } from 'vitest';
import { PlatformApiClient } from './client.js';
describe('sdk client resource wrappers', () => {
    it('covers workspace, workflow, document, and artifact parity methods', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'workspace-1' }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'workspace-1', memory: {} } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'workspace-1', memory: { last_run_summary: {} } } }), {
            status: 200,
        }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ workflow_id: 'pipe-1', kind: 'run_summary' }] }), {
            status: 200,
        }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { workflow_id: 'pipe-1', resolved_config: { retries: 2 } } }), {
            status: 200,
        }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ logical_name: 'brief', scope: 'workspace', source: 'repository', metadata: {} }] }), {
            status: 200,
        }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { logical_name: 'brief', scope: 'workflow', source: 'external', metadata: {} } }), {
            status: 201,
        }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { logical_name: 'brief', scope: 'workflow', source: 'external', metadata: {} } }), {
            status: 200,
        }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'pipe-1' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'artifact-1', task_id: 'task-1' }] }), {
            status: 200,
        }));
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'token',
            fetcher,
        });
        const workspaces = await client.listWorkspaces();
        const workspace = await client.getWorkspace('workspace-1');
        const patched = await client.patchWorkspaceMemory('workspace-1', {
            key: 'last_run_summary',
            value: {},
        });
        const timeline = await client.getWorkspaceTimeline('workspace-1');
        const config = await client.getResolvedWorkflowConfig('pipe-1', true);
        const documents = await client.listWorkflowDocuments('pipe-1');
        const createdDocument = await client.createWorkflowDocument('pipe-1', {
            logical_name: 'brief',
            source: 'external',
            url: 'https://example.com/brief',
        });
        const updatedDocument = await client.updateWorkflowDocument('pipe-1', 'brief', {
            title: 'Brief',
        });
        await client.deleteWorkflowDocument('pipe-1', 'brief');
        const planning = await client.createPlanningWorkflow('workspace-1', { brief: 'Plan next run' });
        const artifacts = await client.listTaskArtifacts('task-1');
        expect(workspaces.data[0].id).toBe('workspace-1');
        expect(workspace.id).toBe('workspace-1');
        expect(patched.memory).toEqual({ last_run_summary: {} });
        expect(timeline[0].workflow_id).toBe('pipe-1');
        expect(config.resolved_config).toEqual({ retries: 2 });
        expect(documents[0].logical_name).toBe('brief');
        expect(createdDocument.scope).toBe('workflow');
        expect(updatedDocument.logical_name).toBe('brief');
        expect(planning.id).toBe('pipe-1');
        expect(artifacts[0].id).toBe('artifact-1');
    });
});
