import { describe, expect, it, vi } from 'vitest';
import { PlatformApiClient } from './client.js';
describe('sdk full client coverage', () => {
    it('covers FR-041 typed client methods for task/workflow/agent/worker APIs', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 't1' }], pagination: { total_pages: 1 } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 't2' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'p1' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'w1' }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'a1' }] }), { status: 200 }));
        const client = new PlatformApiClient({ baseUrl: 'http://localhost:8080', accessToken: 'token', fetcher });
        const list = await client.listTasks();
        const task = await client.getTask('t2');
        const workflow = await client.getWorkflow('p1');
        const workers = await client.listWorkers();
        const agents = await client.listAgents();
        expect(list.data[0].id).toBe('t1');
        expect(task.id).toBe('t2');
        expect(workflow.id).toBe('p1');
        expect(workers[0].id).toBe('w1');
        expect(agents[0].id).toBe('a1');
    });
    it('covers FR-042 background-friendly pagination helper iteration semantics', async () => {
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'token',
            fetcher: vi.fn(),
        });
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({ data: [{ id: '1' }], pagination: { total_pages: 3 } })
            .mockResolvedValueOnce({ data: [{ id: '2' }], pagination: { total_pages: 3 } })
            .mockResolvedValueOnce({ data: [{ id: '3' }], pagination: { total_pages: 3 } });
        const rows = await client.paginate(fetchPage, { perPage: 1, startPage: 1 });
        expect(rows.map((row) => row.id)).toEqual(['1', '2', '3']);
        expect(fetchPage).toHaveBeenCalledTimes(3);
    });
    it('covers FR-043 worker convenience flow primitives (claim + complete) through sdk wrappers', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'task-1' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'task-1', state: 'completed' } }), { status: 200 }));
        const client = new PlatformApiClient({ baseUrl: 'http://localhost:8080', accessToken: 'token', fetcher });
        const claimed = await client.claimTask({ agent_id: 'agent-1', capabilities: ['ts'] });
        const completed = await client.completeTask('task-1', { ok: true });
        expect(claimed?.id).toBe('task-1');
        expect(completed.state).toBe('completed');
    });
    it('keeps auth token mutable for long-running clients', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 't1' } }), { status: 200 }));
        const client = new PlatformApiClient({ baseUrl: 'http://localhost:8080', accessToken: 'old', fetcher });
        client.setAccessToken('new-token');
        await client.getTask('t1');
        const [, options] = vi.mocked(fetcher).mock.calls[0];
        expect((options?.headers).Authorization).toBe('Bearer new-token');
    });
    it('covers project, workflow, document, and artifact parity methods through sdk wrappers', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'project-1' }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'project-1', memory: {} } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'project-1', memory: { last_run_summary: {} } } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ workflow_id: 'pipe-1', kind: 'run_summary' }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { workflow_id: 'pipe-1', resolved_config: { retries: 2 } } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ logical_name: 'brief', scope: 'project', source: 'repository', metadata: {} }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'pipe-1' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'pipe-1', current_phase: 'review' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'pipe-1', state: 'cancelled' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'artifact-1', task_id: 'task-1' }] }), { status: 200 }));
        const client = new PlatformApiClient({ baseUrl: 'http://localhost:8080', accessToken: 'token', fetcher });
        const projects = await client.listProjects();
        const project = await client.getProject('project-1');
        const patched = await client.patchProjectMemory('project-1', { key: 'last_run_summary', value: {} });
        const timeline = await client.getProjectTimeline('project-1');
        const config = await client.getResolvedWorkflowConfig('pipe-1', true);
        const documents = await client.listWorkflowDocuments('pipe-1');
        const planning = await client.createPlanningWorkflow('project-1', { brief: 'Plan next run' });
        const approved = await client.actOnPhaseGate('pipe-1', 'review', { action: 'approve' });
        const cancelled = await client.cancelPhase('pipe-1', 'review');
        const artifacts = await client.listTaskArtifacts('task-1');
        expect(projects.data[0].id).toBe('project-1');
        expect(project.id).toBe('project-1');
        expect(patched.memory).toEqual({ last_run_summary: {} });
        expect(timeline[0].workflow_id).toBe('pipe-1');
        expect(config.resolved_config).toEqual({ retries: 2 });
        expect(documents[0].logical_name).toBe('brief');
        expect(planning.id).toBe('pipe-1');
        expect(approved.current_phase).toBe('review');
        expect(cancelled.state).toBe('cancelled');
        expect(artifacts[0].id).toBe('artifact-1');
    });
});
