import { describe, expect, it, vi } from 'vitest';

import { McpStdioServer, createMessageProcessor } from './index.js';

describe('McpStdioServer', () => {
  function createServer() {
    return new McpStdioServer({
      listTasks: vi.fn().mockResolvedValue([]),
      getTask: vi.fn(),
      createTask: vi.fn(),
      claimTask: vi.fn(),
      completeTask: vi.fn(),
      listPipelines: vi.fn(),
      createPipeline: vi.fn(),
      cancelPipeline: vi.fn(),
    } as never);
  }

  it('lists tools via tools/list', async () => {
    const response = await createServer().handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.error).toBeUndefined();
    expect((response.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
  });

  it('returns invalid params error when tool input fails schema validation', async () => {
    const response = await createServer().handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_task', arguments: {} },
    });

    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('Invalid params');
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
});
