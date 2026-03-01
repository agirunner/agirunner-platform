import { createToolHandlers, TOOL_DEFINITIONS, TOOL_SCHEMAS } from './tools.js';
export class McpStdioServer {
    handlers;
    constructor(client) {
        this.handlers = createToolHandlers(client);
    }
    async handle(request) {
        try {
            if (request.method === 'initialize')
                return this.ok(request.id, this.initializePayload());
            if (request.method === 'tools/list')
                return this.ok(request.id, { tools: TOOL_DEFINITIONS });
            if (request.method === 'notifications/initialized')
                return this.ok(request.id, {});
            if (request.method !== 'tools/call')
                return this.error(request.id, -32601, `Method not found: ${request.method}`);
            const toolName = String(request.params?.name ?? '');
            const rawInput = request.params?.arguments ?? {};
            const schema = TOOL_SCHEMAS[toolName];
            const handler = this.handlers[toolName];
            if (!schema || !handler)
                return this.error(request.id, -32601, `Unknown tool: ${toolName}`);
            const parsed = schema.safeParse(rawInput);
            if (!parsed.success)
                return this.error(request.id, -32602, `Invalid params: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
            const result = await handler(parsed.data);
            return this.ok(request.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result });
        }
        catch (error) {
            return this.error(request.id, -32000, error.message);
        }
    }
    initializePayload() {
        return { protocolVersion: '2024-11-05', serverInfo: { name: 'agentbaton-mcp-server', version: '0.1.0' }, capabilities: { tools: {} } };
    }
    ok(id, result) {
        return { jsonrpc: '2.0', id: id ?? null, result };
    }
    error(id, code, message) {
        return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
    }
}
