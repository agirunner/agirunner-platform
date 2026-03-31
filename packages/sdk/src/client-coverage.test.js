import { describe, expect, it, vi } from 'vitest';
import { PlatformApiClient } from './client.js';
describe('sdk client coverage', () => {
    it('covers typed client methods for task, workflow, agent, and worker APIs', async () => {
        const typedStage = {
            id: 'stage-typed',
            workflow_id: 'wf-typed',
            name: 'build',
            position: 1,
            goal: 'Build',
            status: 'active',
            is_active: true,
            gate_status: 'none',
            iteration_count: 0,
            open_work_item_count: 0,
            total_work_item_count: 0,
        };
        const fetcher = (vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 't1' }], pagination: { total_pages: 1 } }), {
            status: 200,
        }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 't2' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'p1' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'w1' }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'a1' }] }), { status: 200 })));
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'token',
            fetcher,
        });
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
        expect(typedStage.name).toBe('build');
    });
    it('paginates through background-friendly page iteration semantics', async () => {
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
    it('covers worker convenience flow primitives through sdk wrappers', async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'task-1' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'task-1', state: 'completed' } }), {
            status: 200,
        }));
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'token',
            fetcher,
        });
        const claimed = await client.claimTask({ agent_id: 'agent-1' });
        const completed = await client.completeTask('task-1', { ok: true });
        expect(claimed?.id).toBe('task-1');
        expect(completed.state).toBe('completed');
    });
    it('keeps auth token mutable for long-running clients', async () => {
        const fetcher = (vi
            .fn()
            .mockResolvedValue(new Response(JSON.stringify({ data: { id: 't1' } }), { status: 200 })));
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'old',
            fetcher,
        });
        client.setAccessToken('new-token');
        await client.getTask('t1');
        const [, options] = vi.mocked(fetcher).mock.calls[0];
        expect((options?.headers).Authorization).toBe('Bearer new-token');
    });
});
