import { ValidationError } from '../errors/domain-errors.js';
import {
  buildRemoteMcpCapabilitySummary,
  normalizeRemoteMcpPromptSnapshot,
  normalizeRemoteMcpResourceSnapshot,
  normalizeRemoteMcpToolSnapshot,
} from './remote-mcp-capability-snapshot.js';
import type {
  RemoteMcpParameterInput,
  RemoteMcpTransportPreference,
} from './remote-mcp-model.js';
import type { RemoteMcpVerifier } from './remote-mcp-verification-service.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const JSON_RPC_VERSION = '2.0';
const VERIFY_CONTRACT_VERSION = 'remote-mcp-v1';
const CLIENT_NAME = 'agirunner-platform';
const CLIENT_VERSION = '1';

interface VerifyRequest {
  endpointUrl: string;
  callTimeoutSeconds: number;
  transportPreference?: RemoteMcpTransportPreference;
  authMode: 'none' | 'parameterized' | 'oauth';
  parameters: RemoteMcpParameterInput[];
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

interface CapabilityFlags {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
}

export class RemoteMcpHttpVerifier implements RemoteMcpVerifier {
  async verify(input: VerifyRequest) {
    const connection = resolveConnection(input);
    const transportPreference = input.transportPreference ?? 'auto';
    if (transportPreference === 'http_sse_compat') {
      return this.verifyLegacyHttpSse(connection, input.callTimeoutSeconds);
    }
    if (transportPreference === 'streamable_http') {
      return this.verifyStreamableHttp(connection, input.callTimeoutSeconds);
    }
    try {
      return await this.verifyStreamableHttp(connection, input.callTimeoutSeconds);
    } catch (error) {
      if (!isLegacyFallbackCandidate(error)) {
        throw error;
      }
      return this.verifyLegacyHttpSse(connection, input.callTimeoutSeconds);
    }
  }

  private async verifyStreamableHttp(connection: ResolvedConnection, timeoutSeconds: number) {
    const initialize = await this.postJsonRpc(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      1,
      'initialize',
      buildInitializeParams(connection.initializeParams),
      null,
    );
    const sessionId = initialize.sessionId;
    const capabilityFlags = readCapabilityFlags(initialize.result.capabilities);
    await this.postNotification(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      'notifications/initialized',
      {},
      sessionId,
    );
    const tools = await this.postOptionalJsonRpc(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      2,
      'tools/list',
      {},
      sessionId,
      capabilityFlags.tools,
    );
    const resources = await this.postOptionalJsonRpc(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      3,
      'resources/list',
      {},
      sessionId,
      capabilityFlags.resources,
    );
    const prompts = await this.postOptionalJsonRpc(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      4,
      'prompts/list',
      {},
      sessionId,
      capabilityFlags.prompts,
    );
    const toolsResult = isRecord(tools.result) ? tools.result : {};
    const resourcesResult = isRecord(resources.result) ? resources.result : {};
    const promptsResult = isRecord(prompts.result) ? prompts.result : {};
    const discoveredTools = normalizeRemoteMcpToolSnapshot(toolsResult.tools ?? []);
    const discoveredResources = normalizeRemoteMcpResourceSnapshot(resourcesResult.resources ?? []);
    const discoveredPrompts = normalizeRemoteMcpPromptSnapshot(promptsResult.prompts ?? []);
    return {
      verification_status: 'verified' as const,
      verification_error: null,
      verified_transport: 'streamable_http' as const,
      verification_contract_version: VERIFY_CONTRACT_VERSION,
      discovered_tools_snapshot: discoveredTools,
      discovered_resources_snapshot: discoveredResources,
      discovered_prompts_snapshot: discoveredPrompts,
      verified_capability_summary: buildRemoteMcpCapabilitySummary(
        discoveredTools,
        discoveredResources,
        discoveredPrompts,
      ),
      verified_discovery_strategy: 'direct_endpoint',
      verified_oauth_strategy: null,
    };
  }

  private async verifyLegacyHttpSse(connection: ResolvedConnection, timeoutSeconds: number) {
    const streamResponse = await fetchWithTimeout(connection.endpointUrl, timeoutSeconds, {
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
        timeoutSeconds,
        1,
        'initialize',
        buildInitializeParams(connection.initializeParams),
      );
      const initialize = await reader.nextJsonRpcMessage(1);
      const sessionId = initialize.sessionId;
      const capabilityFlags = readCapabilityFlags(initialize.result.capabilities);
      await this.postNotification(
        messageEndpoint,
        connection.headers,
        timeoutSeconds,
        'notifications/initialized',
        {},
        sessionId,
      );
      if (capabilityFlags.tools) {
        await this.postLegacyJsonRpc(messageEndpoint, connection.headers, timeoutSeconds, 2, 'tools/list', {});
      }
      const tools = capabilityFlags.tools ? await reader.nextJsonRpcMessage(2) : { result: { tools: [] as unknown[] } };
      if (capabilityFlags.resources) {
        await this.postLegacyJsonRpc(messageEndpoint, connection.headers, timeoutSeconds, 3, 'resources/list', {});
      }
      const resources = capabilityFlags.resources ? await reader.nextJsonRpcMessage(3) : { result: { resources: [] as unknown[] } };
      if (capabilityFlags.prompts) {
        await this.postLegacyJsonRpc(messageEndpoint, connection.headers, timeoutSeconds, 4, 'prompts/list', {});
      }
      const prompts = capabilityFlags.prompts ? await reader.nextJsonRpcMessage(4) : { result: { prompts: [] as unknown[] } };
      const discoveredTools = normalizeRemoteMcpToolSnapshot(tools.result.tools ?? []);
      const discoveredResources = normalizeRemoteMcpResourceSnapshot(resources.result.resources ?? []);
      const discoveredPrompts = normalizeRemoteMcpPromptSnapshot(prompts.result.prompts ?? []);
      return {
        verification_status: 'verified' as const,
        verification_error: null,
        verified_transport: 'http_sse_compat' as const,
        verification_contract_version: VERIFY_CONTRACT_VERSION,
        discovered_tools_snapshot: discoveredTools,
        discovered_resources_snapshot: discoveredResources,
        discovered_prompts_snapshot: discoveredPrompts,
        verified_capability_summary: buildRemoteMcpCapabilitySummary(
          discoveredTools,
          discoveredResources,
          discoveredPrompts,
        ),
        verified_discovery_strategy: 'direct_endpoint',
        verified_oauth_strategy: null,
      };
    } finally {
      await reader.close();
    }
  }

  private async postJsonRpc(
    endpointUrl: string,
    headers: Record<string, string>,
    timeoutSeconds: number,
    id: number,
    method: string,
    params: Record<string, unknown>,
    sessionId: string | null,
  ) {
    const response = await fetchWithTimeout(endpointUrl, timeoutSeconds, {
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

  private async postOptionalJsonRpc(
    endpointUrl: string,
    headers: Record<string, string>,
    timeoutSeconds: number,
    id: number,
    method: string,
    params: Record<string, unknown>,
    sessionId: string | null,
    supported: boolean,
  ) {
    if (!supported) {
      return { result: {} };
    }
    try {
      return await this.postJsonRpc(endpointUrl, headers, timeoutSeconds, id, method, params, sessionId);
    } catch (error) {
      if (isOptionalListFailure(error)) {
        return { result: {} };
      }
      throw error;
    }
  }

  private async postLegacyJsonRpc(
    endpointUrl: string,
    headers: Record<string, string>,
    timeoutSeconds: number,
    id: number,
    method: string,
    params: Record<string, unknown>,
  ) {
    const response = await fetchWithTimeout(endpointUrl, timeoutSeconds, {
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
    timeoutSeconds: number,
    method: string,
    params: Record<string, unknown>,
    sessionId: string | null,
  ) {
    const response = await fetchWithTimeout(endpointUrl, timeoutSeconds, {
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

async function fetchWithTimeout(
  input: string,
  timeoutSeconds: number,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = Math.max(timeoutSeconds, 1) * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ValidationError(`Remote MCP verification timed out after ${timeoutSeconds} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
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
  const cookies: string[] = [];
  const initializeParams: Record<string, string> = {};
  for (const parameter of input.parameters) {
    const value = parameter.value.trim();
    if (!value) {
      continue;
    }
    if (parameter.placement === 'authorize_request_query'
      || parameter.placement === 'token_request_header'
      || parameter.placement === 'token_request_body_form'
      || parameter.placement === 'token_request_body_json') {
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
    if (parameter.placement === 'cookie') {
      cookies.push(`${parameter.key}=${value}`);
      continue;
    }
    initializeParams[parameter.key] = value;
  }
  if (cookies.length > 0) {
    headers.Cookie = cookies.join('; ');
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

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isLegacyFallbackCandidate(error: unknown) {
  return error instanceof StreamableTransportError
    && [400, 404, 405].includes(error.status);
}

function readCapabilityFlags(value: unknown): CapabilityFlags {
  const capabilities = isRecord(value) ? value : {};
  return {
    tools: capabilities.tools === undefined ? true : capabilities.tools !== null && capabilities.tools !== false,
    resources: capabilities.resources !== undefined && capabilities.resources !== null && capabilities.resources !== false,
    prompts: capabilities.prompts !== undefined && capabilities.prompts !== null && capabilities.prompts !== false,
  };
}

function isOptionalListFailure(error: unknown): boolean {
  if (!(error instanceof ValidationError)) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return normalized.includes('method not found')
    || normalized.includes('not supported')
    || normalized.includes('unsupported');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
