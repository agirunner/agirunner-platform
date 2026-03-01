import type { PlatformApiClient } from '@agentbaton/sdk';

import { createToolHandlers, TOOL_DEFINITIONS, TOOL_SCHEMAS } from './tools.js';
import type { JsonRpcRequest, JsonRpcResponse } from './transport.js';

export class McpStdioServer {
  private readonly handlers: ReturnType<typeof createToolHandlers>;

  constructor(client: PlatformApiClient) {
    this.handlers = createToolHandlers(client);
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      if (request.method === 'initialize') return this.ok(request.id, this.initializePayload());
      if (request.method === 'tools/list') return this.ok(request.id, { tools: TOOL_DEFINITIONS });
      if (request.method === 'notifications/initialized') return this.ok(request.id, {});
      if (request.method !== 'tools/call') return this.error(request.id, -32601, `Method not found: ${request.method}`);

      const toolName = String(request.params?.name ?? '');
      const rawInput = (request.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const schema = TOOL_SCHEMAS[toolName as keyof typeof TOOL_SCHEMAS];
      const handler = this.handlers[toolName as keyof typeof this.handlers];
      if (!schema || !handler) return this.error(request.id, -32601, `Unknown tool: ${toolName}`);

      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) return this.error(request.id, -32602, `Invalid params: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);

      const result = await handler(parsed.data);
      return this.ok(request.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result });
    } catch (error) {
      return this.error(request.id, -32000, (error as Error).message);
    }
  }

  private initializePayload() {
    return { protocolVersion: '2024-11-05', serverInfo: { name: 'agentbaton-mcp-server', version: '0.1.0' }, capabilities: { tools: {} } };
  }

  private ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id: id ?? null, result };
  }

  private error(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  }
}
