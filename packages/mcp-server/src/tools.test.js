import { describe, expect, it, vi } from 'vitest';
import { TOOL_DEFINITIONS, TOOL_SCHEMAS, createToolHandlers } from './tools.js';
describe('mcp tools coverage', () => {
    it('covers FR-038 tool catalog exposes expected operations', () => {
        const names = TOOL_DEFINITIONS.map((tool) => tool.name);
        expect(names).toEqual(expect.arrayContaining([
            'list_tasks',
            'get_task',
            'create_task',
            'claim_task',
            'complete_task',
            'list_pipelines',
            'create_pipeline',
            'cancel_pipeline',
        ]));
    });
    it('covers FR-039 tool schemas enforce required fields', () => {
        expect(TOOL_SCHEMAS.get_task.safeParse({}).success).toBe(false);
        expect(TOOL_SCHEMAS.create_task.safeParse({ title: 'x' }).success).toBe(false);
        expect(TOOL_SCHEMAS.create_task.safeParse({ title: 'x', type: 'code' }).success).toBe(true);
        expect(TOOL_SCHEMAS.cancel_pipeline.safeParse({ id: 'p1' }).success).toBe(true);
    });
    it('covers FR-038/FR-039 handlers delegate all operations to sdk client', async () => {
        const client = {
            listTasks: vi.fn().mockResolvedValue({ data: [] }),
            getTask: vi.fn().mockResolvedValue({ id: 't1' }),
            createTask: vi.fn().mockResolvedValue({ id: 't2' }),
            claimTask: vi.fn().mockResolvedValue({ id: 't3' }),
            completeTask: vi.fn().mockResolvedValue({ id: 't4' }),
            listPipelines: vi.fn().mockResolvedValue({ data: [] }),
            createPipeline: vi.fn().mockResolvedValue({ id: 'p1' }),
            cancelPipeline: vi.fn().mockResolvedValue({ id: 'p2' }),
        };
        const handlers = createToolHandlers(client);
        await handlers.list_tasks({ state: 'ready' });
        await handlers.get_task({ id: 't1' });
        await handlers.create_task({ title: 'Task', type: 'code' });
        await handlers.claim_task({ agent_id: 'a1', capabilities: ['ts'] });
        await handlers.complete_task({ id: 't1', output: { ok: true } });
        await handlers.list_pipelines({ page: 1, per_page: 10 });
        await handlers.create_pipeline({ template_id: 'tpl', name: 'pipe' });
        await handlers.cancel_pipeline({ id: 'p1' });
        expect(client.listTasks).toHaveBeenCalledTimes(1);
        expect(client.getTask).toHaveBeenCalledWith('t1');
        expect(client.createTask).toHaveBeenCalledWith({ title: 'Task', type: 'code' });
        expect(client.claimTask).toHaveBeenCalledWith({ agent_id: 'a1', capabilities: ['ts'] });
        expect(client.completeTask).toHaveBeenCalledWith('t1', { ok: true });
        expect(client.createPipeline).toHaveBeenCalledWith({ template_id: 'tpl', name: 'pipe' });
        expect(client.cancelPipeline).toHaveBeenCalledWith('p1');
    });
});
