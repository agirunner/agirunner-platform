import { describe, expect, it, vi } from 'vitest';

import { TOOL_DEFINITIONS, TOOL_SCHEMAS, createToolHandlers } from './tools.js';

describe('mcp tools coverage', () => {
  it('covers FR-038 tool catalog exposes canonical agirunner_* operations only', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toEqual([
      'agirunner_list_tasks',
      'agirunner_get_task',
      'agirunner_create_task',
      'agirunner_claim_task',
      'agirunner_complete_task',
      'agirunner_list_workflows',
      'agirunner_get_workflow',
      'agirunner_create_workflow',
      'agirunner_cancel_workflow',
      'agirunner_get_workflow_board',
      'agirunner_list_workflow_stages',
      'agirunner_list_workflow_work_items',
      'agirunner_get_workflow_work_item',
      'agirunner_list_workflow_activations',
      'agirunner_create_workflow_work_item',
      'agirunner_update_workflow_work_item',
      'agirunner_act_on_stage_gate',
      'agirunner_list_playbooks',
      'agirunner_get_playbook',
      'agirunner_create_playbook',
      'agirunner_get_approval_queue',
    ]);
    expect(names.every((name) => name.startsWith('agirunner_'))).toBe(true);
  });

  it('covers FR-039 tool schemas enforce required fields for canonical and compatibility names', () => {
    expect(TOOL_SCHEMAS.agirunner_get_task.safeParse({}).success).toBe(false);
    expect(TOOL_SCHEMAS.agirunner_create_task.safeParse({ title: 'x' }).success).toBe(false);
    expect(TOOL_SCHEMAS.agirunner_create_task.safeParse({ title: 'x', type: 'code' }).success).toBe(
      true,
    );
    expect(TOOL_SCHEMAS.cancel_workflow.safeParse({ id: 'p1' }).success).toBe(true);
    expect(TOOL_SCHEMAS.get_workflow_board.safeParse({}).success).toBe(false);
    expect(TOOL_SCHEMAS.agirunner_create_workflow.safeParse({ name: 'pipe' }).success).toBe(false);
    expect(
      TOOL_SCHEMAS.agirunner_create_workflow.safeParse({ name: 'pipe', playbook_id: 'pb-1' })
        .success,
    ).toBe(true);
    expect(
      TOOL_SCHEMAS.create_workflow_work_item.safeParse({
        workflow_id: 'wf-1',
        title: 'Work',
      }).success,
    ).toBe(true);
    expect(
      TOOL_SCHEMAS.agirunner_update_workflow_work_item.safeParse({
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
      }).success,
    ).toBe(true);
    expect(TOOL_SCHEMAS.get_approval_queue.safeParse({}).success).toBe(true);
  });

  it('covers FR-038/FR-039 handlers delegate operations to sdk client (canonical + compatibility aliases)', async () => {
    const client = {
      listTasks: vi.fn().mockResolvedValue({ data: [] }),
      getTask: vi.fn().mockResolvedValue({ id: 't1' }),
      createTask: vi.fn().mockResolvedValue({ id: 't2' }),
      claimTask: vi.fn().mockResolvedValue({ id: 't3' }),
      completeTask: vi.fn().mockResolvedValue({ id: 't4' }),
      listWorkflows: vi.fn().mockResolvedValue({ data: [] }),
      getWorkflow: vi.fn().mockResolvedValue({ id: 'p0' }),
      createWorkflow: vi.fn().mockResolvedValue({ id: 'p1' }),
      cancelWorkflow: vi.fn().mockResolvedValue({ id: 'p2' }),
      getWorkflowBoard: vi
        .fn()
        .mockResolvedValue({ columns: [], work_items: [], stage_summary: [] }),
      listWorkflowStages: vi.fn().mockResolvedValue([]),
      listWorkflowWorkItems: vi.fn().mockResolvedValue([]),
      getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
      listWorkflowActivations: vi.fn().mockResolvedValue([]),
      createWorkflowWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
      updateWorkflowWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1', priority: 'high' }),
      actOnStageGate: vi.fn().mockResolvedValue({ id: 'p1', current_stage: 'review' }),
      listPlaybooks: vi.fn().mockResolvedValue([]),
      getPlaybook: vi.fn().mockResolvedValue({ id: 'pb-1' }),
      createPlaybook: vi.fn().mockResolvedValue({ id: 'pb-2' }),
      getApprovalQueue: vi.fn().mockResolvedValue({ task_approvals: [], stage_gates: [] }),
    };

    const handlers = createToolHandlers(client as never);

    await handlers.agirunner_list_tasks({ state: 'ready' });
    await handlers.agirunner_get_task({ id: 't1' });
    await handlers.agirunner_create_task({ title: 'Task', type: 'code' });
    await handlers.agirunner_claim_task({ agent_id: 'a1', capabilities: ['ts'] });
    await handlers.agirunner_complete_task({ id: 't1', output: { ok: true } });
    await handlers.agirunner_list_workflows({ page: 1, per_page: 10 });
    await handlers.agirunner_get_workflow({ id: 'p0' });
    await handlers.agirunner_create_workflow({ playbook_id: 'pb-1', name: 'pipe' });
    await handlers.agirunner_cancel_workflow({ id: 'p1' });
    await handlers.agirunner_get_workflow_board({ workflow_id: 'p1' });
    await handlers.agirunner_list_workflow_stages({ workflow_id: 'p1' });
    await handlers.agirunner_list_workflow_work_items({ workflow_id: 'p1' });
    await handlers.agirunner_get_workflow_work_item({ workflow_id: 'p1', work_item_id: 'wi-1' });
    await handlers.agirunner_list_workflow_activations({ workflow_id: 'p1' });
    await handlers.agirunner_create_workflow_work_item({
      workflow_id: 'p1',
      title: 'Investigate',
    });
    await handlers.agirunner_update_workflow_work_item({
      workflow_id: 'p1',
      work_item_id: 'wi-1',
      priority: 'high',
    });
    await handlers.agirunner_act_on_stage_gate({
      workflow_id: 'p1',
      stage_name: 'review',
      action: 'approve',
    });
    await handlers.agirunner_list_playbooks();
    await handlers.agirunner_get_playbook({ id: 'pb-1' });
    await handlers.agirunner_create_playbook({ name: 'Ship', outcome: 'Ship', definition: {} });
    await handlers.agirunner_get_approval_queue();

    await handlers.list_tasks({ state: 'ready' });
    await handlers.cancel_workflow({ id: 'p1' });
    await handlers.get_approval_queue({});

    expect(client.listTasks).toHaveBeenCalledTimes(2);
    expect(client.getTask).toHaveBeenCalledWith('t1');
    expect(client.createTask).toHaveBeenCalledWith({ title: 'Task', type: 'code' });
    expect(client.claimTask).toHaveBeenCalledWith({ agent_id: 'a1', capabilities: ['ts'] });
    expect(client.completeTask).toHaveBeenCalledWith('t1', { ok: true });
    expect(client.getWorkflow).toHaveBeenCalledWith('p0');
    expect(client.createWorkflow).toHaveBeenCalledWith({ playbook_id: 'pb-1', name: 'pipe' });
    expect(client.cancelWorkflow).toHaveBeenCalledTimes(2);
    expect(client.getWorkflowWorkItem).toHaveBeenCalledWith('p1', 'wi-1');
    expect(client.createWorkflowWorkItem).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ title: 'Investigate' }),
    );
    expect(client.updateWorkflowWorkItem).toHaveBeenCalledWith(
      'p1',
      'wi-1',
      expect.objectContaining({ priority: 'high' }),
    );
    expect(client.actOnStageGate).toHaveBeenCalledWith('p1', 'review', {
      action: 'approve',
      feedback: undefined,
    });
    expect(client.getApprovalQueue).toHaveBeenCalledTimes(2);
  });
});
