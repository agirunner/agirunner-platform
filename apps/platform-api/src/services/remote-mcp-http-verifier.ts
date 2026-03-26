import { ValidationError } from '../errors/domain-errors.js';
import type { RemoteMcpVerifier } from './remote-mcp-verification-service.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const JSON_RPC_VERSION = '2.0';
const VERIFY_CONTRACT_VERSION = 'remote-mcp-v1';
const CLIENT_NAME = 'agirunner-platform';
const CLIENT_VERSION = '1';

interface VerifyRequest {
  endpointUrl: string;
  authMode: 'none' | 'parameterized' | 'oauth';
  parameters: Array<{
    placement: 'path' | 'query' | 'header' | 'initialize_param';
    key: string;
    valueKind: 'static' | 'secret';
    value: string;
  }>;
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: {
    code?: number;
    message?: string;
  } | null;
}

interface ResolvedConnection {
  endpointUrl: string;
  headers: Record<string, string>;
  initializeParams: Record<string, string>;
}

export class RemoteMcpHttpVerifier implements RemoteMcpVerifier {
  async verify(input: VerifyRequest) {
    const connection = resolveConnection(input);
    try {
      return await this.verifyStreamableHttp(connection);
    } catch (error) {
      if (!isLegacyFallbackCandidate(error)) {
        throw error;
      }
      return this.verifyLegacyHttpSse(connection);
    }
  }

  private async verifyStreamableHttp(connection: ResolvedConnection) {
    const initialize = await this.postJsonRpc(
      connection.endpointUrl,
      connection.headers,
      1,
      'initialize',
      buildInitializeParams(connection.initializeParams),
      null,
    );
    const sessionId = initialize.sessionId;
    await this.postNotification(
      connection.endpointUrl,
      connection.headers,
      'notifications/initialized',
      {},
      sessionId,
    );
    const tools = await this.postJsonRpc(
      connection.endpointUrl,
      connection.headers,
      2,
      'tools/list',
      {},
      sessionId,
    );
    return {
      verification_status: 'verified' as const,
      verification_error: null,
      verified_transport: 'streamable_http' as const,
      verification_contract_version: VERIFY_CONTRACT_VERSION,
      discovered_tools_snapshot: normalizeToolSnapshot(tools.result.tools),
    };
  }

  private async verifyLegacyHttpSse(connection: ResolvedConnection) {
    const streamResponse = await fetch(connection.endpointUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        ...connection.headers,
      },
    });
    if (!streamResponse.ok) {
      throw new ValidationError(`Remote MCP legacy SSE verification failed with status ${streamResponse.status}`);
    }

    const reader = new SseEventReader(streamResponse);
    try {
      const endpointEvent = await reader.nextEvent();
      if (!endpointEvent || endpointEvent.event !== 'endpoint' || !endpointEvent.data) {
        throw new ValidationError('Remote MCP legacy SSE endpoint event was not received');
      }
      const messageEndpoint = new URL(endpointEvent.data, connection.endpointUrl).toString();
      await this.postLegacyJsonRpc(
        messageEndpoint,
        connection.headers,
        1,
        'initialize',
        buildInitializeParams(connection.initializeParams),
      );
      const initialize = await reader.nextJsonRpcMessage(1);
      const sessionId = initialize.sessionId;
      await this.postNotification(
        messageEndpoint,
        connection.headers,
        'notifications/initialized',
        {},
        sessionId,
      );
      await this.postLegacyJsonRpc(messageEndpoint, connection.headers, 2, 'tools/list', {});
      const tools = await reader.nextJsonRpcMessage(2);
      return {
        verification_status: 'verified' as const,
        verification_error: null,
        verified_transport: 'http_sse_compat' as const,
        verification_contract_version: VERIFY_CONTRACT_VERSION,
        discovered_tools_snapshot: normalizeToolSnapshot(tools.result.tools),
      };
    } finally {
      await reader.close();
    }
  }

  private async postJsonRpc(
    endpointUrl: string,
    headers: Record<string, string>,
    id: number,
    method: string,
    params: Record<string, unknown>,
    sessionId: string | null,
  ) {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: buildRequestHeaders(headers, sessionId),
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        id,
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new StreamableTransportError(response.status);
    }
    return readJsonRpcResponse(response, id);
  }

  private async postLegacyJsonRpc(
    endpointUrl: string,
    headers: Record<string, string>,
    id: number,
    method: string,
    params: Record<string, unknown>,
  ) {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        id,
        method,
        params,
      }),
    });
    if (!response.ok && response.status !== 202) {
      throw new ValidationError(`Remote MCP legacy request failed with status ${response.status}`);
    }
  }

  private async postNotification(
    endpointUrl: string,
    headers: Record<string, string>,
    method: string,
    params: Record<string, unknown>,
    sessionId: string | null,
  ) {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: buildRequestHeaders(headers, sessionId),
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
      }),
    });
    if (!response.ok && response.status !== 202) {
      throw new ValidationError(`Remote MCP notification failed with status ${response.status}`);
    }
  }
}

class StreamableTransportError extends Error {
  constructor(readonly status: number) {
    super(`Remote MCP streamable HTTP verification failed with status ${status}`);
  }
}

class SseEventReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(response: Response) {
    this.reader = response.body?.getReader() ?? null;
  }

  async nextJsonRpcMessage(expectedId: number) {
    while (true) {
      const event = await this.nextEvent();
      if (!event?.data) {
        throw new ValidationError('Remote MCP legacy SSE stream ended before a response arrived');
      }
      const parsed = parseJsonRpcEnvelope(event.data);
      if (parsed.id === expectedId) {
        if (parsed.error?.message) {
          throw new ValidationError(parsed.error.message);
        }
        return {
          result: parsed.result ?? {},
          sessionId: event.sessionId,
        };
      }
    }
  }

  async nextEvent(): Promise<{ event: string | null; data: string; sessionId: string | null } | null> {
    while (true) {
      const boundary = this.buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const raw = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        if (raw.trim().length === 0) {
          continue;
        }
        return parseSseEvent(raw);
      }
      if (!this.reader) {
        if (this.buffer.trim().length === 0) {
          return null;
        }
        const raw = this.buffer;
        this.buffer = '';
        return parseSseEvent(raw);
      }
      const chunk = await this.reader.read();
      if (chunk.done) {
        if (this.buffer.trim().length === 0) {
          return null;
        }
        const raw = this.buffer;
        this.buffer = '';
        return parseSseEvent(raw);
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async close() {
    await this.reader?.cancel().catch(() => undefined);
  }
}

function resolveConnection(input: VerifyRequest): ResolvedConnection {
  const endpoint = new URL(input.endpointUrl);
  const headers: Record<string, string> = {};
  const initializeParams: Record<string, string> = {};
  for (const parameter of input.parameters) {
    const value = parameter.value.trim();
    if (!value) {
      continue;
    }
    if (parameter.placement === 'path') {
      endpoint.pathname = endpoint.pathname.replaceAll(
        `{${parameter.key}}`,
        encodeURIComponent(value),
      );
      continue;
    }
    if (parameter.placement === 'query') {
      endpoint.searchParams.set(parameter.key, value);
      continue;
    }
    if (parameter.placement === 'header') {
      headers[parameter.key] = value;
      continue;
    }
    initializeParams[parameter.key] = value;
  }
  return {
    endpointUrl: endpoint.toString(),
    headers,
    initializeParams,
  };
}

function buildInitializeParams(
  initializeParams: Record<string, string>,
): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: CLIENT_NAME,
      version: CLIENT_VERSION,
    },
    ...initializeParams,
  };
}

function buildRequestHeaders(
  headers: Record<string, string>,
  sessionId: string | null,
): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
    ...headers,
  };
}

async function readJsonRpcResponse(response: Response, expectedId: number) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const reader = new SseEventReader(response);
    try {
      const envelope = await reader.nextJsonRpcMessage(expectedId);
      return {
        result: envelope.result,
        sessionId: envelope.sessionId ?? response.headers.get('mcp-session-id'),
      };
    } finally {
      await reader.close();
    }
  }

  const parsed = parseJsonRpcEnvelope(await response.text());
  if (parsed.error?.message) {
    throw new ValidationError(parsed.error.message);
  }
  if (parsed.id !== expectedId) {
    throw new ValidationError('Remote MCP response id did not match the request');
  }
  return {
    result: parsed.result ?? {},
    sessionId: response.headers.get('mcp-session-id'),
  };
}

function parseJsonRpcEnvelope(raw: string): JsonRpcEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as JsonRpcEnvelope;
  } catch {
    throw new ValidationError('Remote MCP returned invalid JSON-RPC payload');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ValidationError('Remote MCP returned invalid JSON-RPC payload');
  }
  return parsed as JsonRpcEnvelope;
}

function parseSseEvent(raw: string) {
  const lines = raw.split('\n');
  let event: string | null = null;
  let data = '';
  let sessionId: string | null = null;
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      const chunk = line.slice('data:'.length).trim();
      data = data ? `${data}\n${chunk}` : chunk;
      continue;
    }
    if (line.startsWith('mcp-session-id:')) {
      sessionId = line.slice('mcp-session-id:'.length).trim();
    }
  }
  return { event, data, sessionId };
}

function normalizeToolSnapshot(value: unknown) {
  if (!Array.isArray(value)) {
    throw new ValidationError('Remote MCP tools/list response did not include a tools array');
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const tool = entry as Record<string, unknown>;
    const name = readString(tool.name);
    if (!name) {
      return [];
    }
    return [{
      original_name: name,
      description: readString(tool.description),
      input_schema:
        tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
          ? tool.inputSchema
          : {},
    }];
  });
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isLegacyFallbackCandidate(error: unknown) {
  return error instanceof StreamableTransportError
    && [400, 404, 405].includes(error.status);
}
