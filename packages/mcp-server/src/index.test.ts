import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpStdioServer, createMessageProcessor } from './index.js';

function createClient() {
  return {
    listTasks: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
    getTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
    createTask: vi.fn().mockResolvedValue({ id: 'task-created' }),
    claimTask: vi.fn().mockResolvedValue({ id: 'task-claimed' }),
    completeTask: vi.fn().mockResolvedValue({ id: 'task-completed' }),
    listWorkflows: vi.fn().mockResolvedValue([{ id: 'pipe-1' }]),
    getWorkflow: vi.fn().mockResolvedValue({ id: 'pipe-1' }),
    createWorkflow: vi.fn().mockResolvedValue({ id: 'pipe-created' }),
    cancelWorkflow: vi.fn().mockResolvedValue({ id: 'pipe-cancelled' }),
    getWorkflowBoard: vi.fn().mockResolvedValue({ columns: [], work_items: [], stage_summary: [] }),
    listWorkflowStages: vi.fn().mockResolvedValue([]),
    listWorkflowWorkItems: vi.fn().mockResolvedValue([]),
    getWorkflowWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
    listWorkflowActivations: vi.fn().mockResolvedValue([]),
    createWorkflowWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
    updateWorkflowWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
    actOnStageGate: vi.fn().mockResolvedValue({ id: 'pipe-1' }),
    listPlaybooks: vi.fn().mockResolvedValue([{ id: 'pb-1' }]),
    getPlaybook: vi.fn().mockResolvedValue({ id: 'pb-1' }),
    createPlaybook: vi.fn().mockResolvedValue({ id: 'pb-created' }),
    getApprovalQueue: vi.fn().mockResolvedValue({ task_approvals: [], stage_gates: [] }),
  };
}

describe('McpStdioServer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists tools via tools/list', async () => {
    const response = await new McpStdioServer(createClient() as never).handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(response.error).toBeUndefined();
    expect((response.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
  });

  it.each([
    { name: 'list_tasks', args: { state: 'ready' }, method: 'listTasks' },
    { name: 'get_task', args: { id: 'task-1' }, method: 'getTask' },
    { name: 'create_task', args: { title: 'Do work', type: 'code' }, method: 'createTask' },
    {
      name: 'claim_task',
      args: { agent_id: 'agent-1', capabilities: ['ts'] },
      method: 'claimTask',
    },
    { name: 'complete_task', args: { id: 'task-1', output: { ok: true } }, method: 'completeTask' },
    { name: 'list_workflows', args: { state: 'active' }, method: 'listWorkflows' },
    { name: 'get_workflow', args: { id: 'pipe-1' }, method: 'getWorkflow' },
    {
      name: 'create_workflow',
      args: { playbook_id: 'pb-1', name: 'Pipe' },
      method: 'createWorkflow',
    },
    { name: 'cancel_workflow', args: { id: 'pipe-1' }, method: 'cancelWorkflow' },
    { name: 'get_workflow_board', args: { workflow_id: 'pipe-1' }, method: 'getWorkflowBoard' },
    { name: 'list_workflow_stages', args: { workflow_id: 'pipe-1' }, method: 'listWorkflowStages' },
    {
      name: 'list_workflow_work_items',
      args: { workflow_id: 'pipe-1' },
      method: 'listWorkflowWorkItems',
    },
    {
      name: 'get_workflow_work_item',
      args: { workflow_id: 'pipe-1', work_item_id: 'wi-1' },
      method: 'getWorkflowWorkItem',
    },
    {
      name: 'list_workflow_activations',
      args: { workflow_id: 'pipe-1' },
      method: 'listWorkflowActivations',
    },
    {
      name: 'create_workflow_work_item',
      args: { workflow_id: 'pipe-1', title: 'Investigate' },
      method: 'createWorkflowWorkItem',
    },
    {
      name: 'update_workflow_work_item',
      args: { workflow_id: 'pipe-1', work_item_id: 'wi-1', priority: 'high' },
      method: 'updateWorkflowWorkItem',
    },
    {
      name: 'act_on_stage_gate',
      args: { workflow_id: 'pipe-1', stage_name: 'review', action: 'approve' },
      method: 'actOnStageGate',
    },
    { name: 'list_playbooks', args: {}, method: 'listPlaybooks' },
    { name: 'get_playbook', args: { id: 'pb-1' }, method: 'getPlaybook' },
    {
      name: 'create_playbook',
      args: { name: 'Ship', outcome: 'Ship', definition: {} },
      method: 'createPlaybook',
    },
    { name: 'get_approval_queue', args: {}, method: 'getApprovalQueue' },
  ])('executes %s handler and returns structured content', async ({ name, args, method }) => {
    const client = createClient();
    const server = new McpStdioServer(client as never);

    const response = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    expect(response.error).toBeUndefined();
    expect(client[method as keyof typeof client]).toHaveBeenCalledTimes(1);
    expect(response.result).toMatchObject({
      content: [{ type: 'text' }],
      structuredContent: expect.anything(),
    });
  });

  it.each([
    { name: 'get_task', args: {}, missing: 'id' },
    { name: 'create_task', args: { type: 'code' }, missing: 'title' },
    { name: 'claim_task', args: {}, missing: 'agent_id' },
    { name: 'complete_task', args: { output: {} }, missing: 'id' },
    { name: 'create_workflow', args: { playbook_id: 'pb-1' }, missing: 'name' },
    { name: 'cancel_workflow', args: {}, missing: 'id' },
    { name: 'create_workflow_work_item', args: { workflow_id: 'pipe-1' }, missing: 'title' },
    { name: 'update_workflow_work_item', args: { workflow_id: 'pipe-1' }, missing: 'work_item_id' },
    { name: 'act_on_stage_gate', args: { workflow_id: 'pipe-1' }, missing: 'stage_name' },
    { name: 'create_playbook', args: { name: 'Ship' }, missing: 'outcome' },
  ])(
    'returns invalid params for %s when required params are missing',
    async ({ name, args, missing }) => {
      const response = await new McpStdioServer(createClient() as never).handle({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name, arguments: args },
      });

      expect(response.error?.code).toBe(-32602);
      expect(response.error?.message).toContain(missing);
    },
  );

  it.each([
    { tool: 'get_task', args: { id: 'missing' }, error: 'HTTP 404: not found' },
    { tool: 'create_task', args: { title: 'x', type: 'code' }, error: 'HTTP 401: unauthorized' },
    { tool: 'cancel_workflow', args: { id: 'missing' }, error: 'HTTP 404: not found' },
  ])('surfaces tool execution errors for %s', async ({ tool, args, error }) => {
    const client = createClient();
    if (tool === 'get_task') {
      client.getTask.mockRejectedValueOnce(new Error(error));
    }
    if (tool === 'create_task') {
      client.createTask.mockRejectedValueOnce(new Error(error));
    }
    if (tool === 'cancel_workflow') {
      client.cancelWorkflow.mockRejectedValueOnce(new Error(error));
    }

    const response = await new McpStdioServer(client as never).handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    });

    expect(response.error?.code).toBe(-32000);
    expect(response.error?.message).toContain(error);
  });

  it('returns method not found for unknown methods', async () => {
    const response = await new McpStdioServer(createClient() as never).handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'nope',
    });
    expect(response.error?.code).toBe(-32601);
  });

  it('returns unknown tool error', async () => {
    const response = await new McpStdioServer(createClient() as never).handle({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'unknown_tool', arguments: {} },
    });

    expect(response.error?.code).toBe(-32601);
    expect(response.error?.message).toContain('Unknown tool');
  });

  it('keeps notification responses id as null', async () => {
    const response = await new McpStdioServer(createClient() as never).handle({
      jsonrpc: '2.0',
      method: 'tools/list',
    });
    expect(response.id).toBeNull();
  });

  it('returns parse error response for malformed JSON in transport', () => {
    const malformedSpy = vi.fn();
    const processor = createMessageProcessor(async () => {}, malformedSpy);
    const malformedBody = '{"jsonrpc":x}';

    processor(Buffer.from(`Content-Length: ${malformedBody.length}\r\n\r\n${malformedBody}`));

    expect(malformedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonrpc: '2.0',
        id: null,
        error: expect.objectContaining({ code: -32700 }),
      }),
    );
  });

  it('does not crash when onMessage rejects — returns parse error instead', async () => {
    vi.useFakeTimers();

    const malformedSpy = vi.fn();
    const processor = createMessageProcessor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error('boom');
    }, malformedSpy);
    const validBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    processor(Buffer.from(`Content-Length: ${validBody.length}\r\n\r\n${validBody}`));

    await vi.advanceTimersByTimeAsync(5);

    expect(malformedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonrpc: '2.0',
        id: null,
        error: expect.objectContaining({ code: -32700 }),
      }),
    );
  });

  it('continues processing after malformed JSON instead of stopping', () => {
    const onMessage = vi.fn(async () => {});
    const malformedSpy = vi.fn();
    const processor = createMessageProcessor(onMessage, malformedSpy);
    const badBody = '{invalid json}';
    const goodBody = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    // Send both messages in a single chunk
    const chunk =
      `Content-Length: ${badBody.length}\r\n\r\n${badBody}` +
      `Content-Length: ${goodBody.length}\r\n\r\n${goodBody}`;
    processor(Buffer.from(chunk));

    expect(malformedSpy).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('passes batch payload through parser for protocol edge handling', async () => {
    const onMessage = vi.fn(async () => {});
    const malformedSpy = vi.fn();
    const processor = createMessageProcessor(onMessage, malformedSpy);
    const batchBody = JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', method: 'tools/list' },
    ]);

    processor(Buffer.from(`Content-Length: ${batchBody.length}\r\n\r\n${batchBody}`));

    await Promise.resolve();
    expect(malformedSpy).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith(expect.any(Array));
  });
});
