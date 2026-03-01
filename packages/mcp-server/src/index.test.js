import { describe, expect, it, vi } from 'vitest';
import { McpStdioServer, createMessageProcessor } from './index.js';
function createClient() {
    return {
        listTasks: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
        getTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
        createTask: vi.fn().mockResolvedValue({ id: 'task-created' }),
        claimTask: vi.fn().mockResolvedValue({ id: 'task-claimed' }),
        completeTask: vi.fn().mockResolvedValue({ id: 'task-completed' }),
        listPipelines: vi.fn().mockResolvedValue([{ id: 'pipe-1' }]),
        createPipeline: vi.fn().mockResolvedValue({ id: 'pipe-created' }),
        cancelPipeline: vi.fn().mockResolvedValue({ id: 'pipe-cancelled' }),
    };
}
describe('McpStdioServer', () => {
    it('lists tools via tools/list', async () => {
        const response = await new McpStdioServer(createClient()).handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
        expect(response.error).toBeUndefined();
        expect(response.result.tools.length).toBeGreaterThan(0);
    });
    it.each([
        { name: 'list_tasks', args: { state: 'ready' }, method: 'listTasks' },
        { name: 'get_task', args: { id: 'task-1' }, method: 'getTask' },
        { name: 'create_task', args: { title: 'Do work', type: 'code' }, method: 'createTask' },
        { name: 'claim_task', args: { agent_id: 'agent-1', capabilities: ['ts'] }, method: 'claimTask' },
        { name: 'complete_task', args: { id: 'task-1', output: { ok: true } }, method: 'completeTask' },
        { name: 'list_pipelines', args: { state: 'active' }, method: 'listPipelines' },
        { name: 'create_pipeline', args: { template_id: 'tpl-1', name: 'Pipe' }, method: 'createPipeline' },
        { name: 'cancel_pipeline', args: { id: 'pipe-1' }, method: 'cancelPipeline' },
    ])('executes %s handler and returns structured content', async ({ name, args, method }) => {
        const client = createClient();
        const server = new McpStdioServer(client);
        const response = await server.handle({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name, arguments: args },
        });
        expect(response.error).toBeUndefined();
        expect(client[method]).toHaveBeenCalledTimes(1);
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
        { name: 'create_pipeline', args: { template_id: 'tpl-1' }, missing: 'name' },
        { name: 'cancel_pipeline', args: {}, missing: 'id' },
    ])('returns invalid params for %s when required params are missing', async ({ name, args, missing }) => {
        const response = await new McpStdioServer(createClient()).handle({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name, arguments: args },
        });
        expect(response.error?.code).toBe(-32602);
        expect(response.error?.message).toContain(missing);
    });
    it.each([
        { tool: 'get_task', args: { id: 'missing' }, error: 'HTTP 404: not found' },
        { tool: 'create_task', args: { title: 'x', type: 'code' }, error: 'HTTP 401: unauthorized' },
        { tool: 'cancel_pipeline', args: { id: 'missing' }, error: 'HTTP 404: not found' },
    ])('surfaces tool execution errors for %s', async ({ tool, args, error }) => {
        const client = createClient();
        if (tool === 'get_task') {
            client.getTask.mockRejectedValueOnce(new Error(error));
        }
        if (tool === 'create_task') {
            client.createTask.mockRejectedValueOnce(new Error(error));
        }
        if (tool === 'cancel_pipeline') {
            client.cancelPipeline.mockRejectedValueOnce(new Error(error));
        }
        const response = await new McpStdioServer(client).handle({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: tool, arguments: args },
        });
        expect(response.error?.code).toBe(-32000);
        expect(response.error?.message).toContain(error);
    });
    it('returns method not found for unknown methods', async () => {
        const response = await new McpStdioServer(createClient()).handle({ jsonrpc: '2.0', id: 5, method: 'nope' });
        expect(response.error?.code).toBe(-32601);
    });
    it('returns unknown tool error', async () => {
        const response = await new McpStdioServer(createClient()).handle({
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: { name: 'unknown_tool', arguments: {} },
        });
        expect(response.error?.code).toBe(-32601);
        expect(response.error?.message).toContain('Unknown tool');
    });
    it('keeps notification responses id as null', async () => {
        const response = await new McpStdioServer(createClient()).handle({
            jsonrpc: '2.0',
            method: 'tools/list',
        });
        expect(response.id).toBeNull();
    });
    it('returns parse error response for malformed JSON in transport', () => {
        const malformedSpy = vi.fn();
        const processor = createMessageProcessor(async () => { }, malformedSpy);
        const malformedBody = '{"jsonrpc":x}';
        processor(Buffer.from(`Content-Length: ${malformedBody.length}\r\n\r\n${malformedBody}`));
        expect(malformedSpy).toHaveBeenCalledWith(expect.objectContaining({
            jsonrpc: '2.0',
            id: null,
            error: expect.objectContaining({ code: -32700 }),
        }));
    });
    it('passes batch payload through parser for protocol edge handling', async () => {
        const onMessage = vi.fn(async () => { });
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
