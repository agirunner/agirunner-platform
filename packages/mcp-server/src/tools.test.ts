import { describe, expect, it, vi } from 'vitest';

import { TOOL_DEFINITIONS, TOOL_SCHEMAS, createToolHandlers } from './tools.js';

describe('mcp tools coverage', () => {
  it('covers FR-038 tool catalog exposes expected baton_* operations and aliases', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'baton_list_tasks',
        'baton_get_task',
        'baton_create_task',
        'baton_claim_task',
        'baton_complete_task',
        'baton_list_workflows',
        'baton_create_workflow',
        'baton_cancel_workflow',
        'list_tasks',
        'cancel_workflow',
      ]),
    );
  });

  it('covers FR-039 tool schemas enforce required fields for baton_* and aliases', () => {
    expect(TOOL_SCHEMAS.baton_get_task.safeParse({}).success).toBe(false);
    expect(TOOL_SCHEMAS.baton_create_task.safeParse({ title: 'x' }).success).toBe(false);
    expect(TOOL_SCHEMAS.baton_create_task.safeParse({ title: 'x', type: 'code' }).success).toBe(
      true,
    );
    expect(TOOL_SCHEMAS.baton_cancel_workflow.safeParse({ id: 'p1' }).success).toBe(true);
    expect(TOOL_SCHEMAS.cancel_workflow.safeParse({ id: 'p1' }).success).toBe(true);
  });

  it('covers FR-038/FR-039 handlers delegate operations to sdk client (canonical + aliases)', async () => {
    const client = {
      listTasks: vi.fn().mockResolvedValue({ data: [] }),
      getTask: vi.fn().mockResolvedValue({ id: 't1' }),
      createTask: vi.fn().mockResolvedValue({ id: 't2' }),
      claimTask: vi.fn().mockResolvedValue({ id: 't3' }),
      completeTask: vi.fn().mockResolvedValue({ id: 't4' }),
      listWorkflows: vi.fn().mockResolvedValue({ data: [] }),
      createWorkflow: vi.fn().mockResolvedValue({ id: 'p1' }),
      cancelWorkflow: vi.fn().mockResolvedValue({ id: 'p2' }),
    };

    const handlers = createToolHandlers(client as never);

    await handlers.baton_list_tasks({ state: 'ready' });
    await handlers.baton_get_task({ id: 't1' });
    await handlers.baton_create_task({ title: 'Task', type: 'code' });
    await handlers.baton_claim_task({ agent_id: 'a1', capabilities: ['ts'] });
    await handlers.baton_complete_task({ id: 't1', output: { ok: true } });
    await handlers.baton_list_workflows({ page: 1, per_page: 10 });
    await handlers.baton_create_workflow({ template_id: 'tpl', name: 'pipe' });
    await handlers.baton_cancel_workflow({ id: 'p1' });

    await handlers.list_tasks({ state: 'ready' });
    await handlers.cancel_workflow({ id: 'p1' });

    expect(client.listTasks).toHaveBeenCalledTimes(2);
    expect(client.getTask).toHaveBeenCalledWith('t1');
    expect(client.createTask).toHaveBeenCalledWith({ title: 'Task', type: 'code' });
    expect(client.claimTask).toHaveBeenCalledWith({ agent_id: 'a1', capabilities: ['ts'] });
    expect(client.completeTask).toHaveBeenCalledWith('t1', { ok: true });
    expect(client.createWorkflow).toHaveBeenCalledWith({ template_id: 'tpl', name: 'pipe' });
    expect(client.cancelWorkflow).toHaveBeenCalledTimes(2);
  });
});
