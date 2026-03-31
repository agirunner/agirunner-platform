import {
  buildRemoteMcpCapabilitySummary,
  normalizeRemoteMcpPromptSnapshot,
  normalizeRemoteMcpResourceSnapshot,
  normalizeRemoteMcpToolSnapshot,
} from '../core/remote-mcp-capability-snapshot.js';
import type { RemoteMcpVerifier } from './remote-mcp-verification-service.js';
import { VERIFY_CONTRACT_VERSION } from '../../remote-mcp-http-verifier/constants.js';
import {
  buildInitializeParams,
  isRecord,
  readCapabilityFlags,
  resolveConnection,
} from '../../remote-mcp-http-verifier/shared.js';
import { ValidationError } from '../../../errors/domain-errors.js';
import { SseEventReader } from '../../remote-mcp-http-verifier/sse.js';
import {
  postJsonRpc,
  postLegacyJsonRpc,
  postNotification,
  postOptionalJsonRpc,
  StreamableTransportError,
} from '../../remote-mcp-http-verifier/transport.js';
import type {
  ResolvedConnection,
  VerifyRequest,
} from '../../remote-mcp-http-verifier/types.js';

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
    const initialize = await postJsonRpc(
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
    await postNotification(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      'notifications/initialized',
      {},
      sessionId,
    );
    const tools = await postOptionalJsonRpc(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      2,
      'tools/list',
      {},
      sessionId,
      capabilityFlags.tools,
    );
    const resources = await postOptionalJsonRpc(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      3,
      'resources/list',
      {},
      sessionId,
      capabilityFlags.resources,
    );
    const prompts = await postOptionalJsonRpc(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
      4,
      'prompts/list',
      {},
      sessionId,
      capabilityFlags.prompts,
    );
    return buildVerificationResult(
      'streamable_http',
      readSnapshotList(tools.result, 'tools'),
      readSnapshotList(resources.result, 'resources'),
      readSnapshotList(prompts.result, 'prompts'),
    );
  }

  private async verifyLegacyHttpSse(connection: ResolvedConnection, timeoutSeconds: number) {
    const streamResponse = await postLegacyJsonRpc.openStream(
      connection.endpointUrl,
      connection.headers,
      timeoutSeconds,
    );
    const reader = new SseEventReader(streamResponse);
    try {
      const endpointEvent = await reader.nextEvent();
      if (!endpointEvent || endpointEvent.event !== 'endpoint' || !endpointEvent.data) {
        throw new ValidationError('Remote MCP legacy SSE endpoint event was not received');
      }

      const messageEndpoint = new URL(endpointEvent.data, connection.endpointUrl).toString();
      await postLegacyJsonRpc.send(
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
      await postNotification(
        messageEndpoint,
        connection.headers,
        timeoutSeconds,
        'notifications/initialized',
        {},
        sessionId,
      );
      const tools = await readLegacyListResult(
        reader,
        messageEndpoint,
        connection.headers,
        timeoutSeconds,
        2,
        'tools/list',
        'tools',
        capabilityFlags.tools,
      );
      const resources = await readLegacyListResult(
        reader,
        messageEndpoint,
        connection.headers,
        timeoutSeconds,
        3,
        'resources/list',
        'resources',
        capabilityFlags.resources,
      );
      const prompts = await readLegacyListResult(
        reader,
        messageEndpoint,
        connection.headers,
        timeoutSeconds,
        4,
        'prompts/list',
        'prompts',
        capabilityFlags.prompts,
      );
      return buildVerificationResult(
        'http_sse_compat',
        tools,
        resources,
        prompts,
      );
    } finally {
      await reader.close();
    }
  }
}

async function readLegacyListResult(
  reader: SseEventReader,
  endpointUrl: string,
  headers: Record<string, string>,
  timeoutSeconds: number,
  id: number,
  method: string,
  key: 'tools' | 'resources' | 'prompts',
  supported: boolean,
) {
  if (!supported) {
    return [];
  }

  await postLegacyJsonRpc.send(endpointUrl, headers, timeoutSeconds, id, method, {});
  const response = await reader.nextJsonRpcMessage(id);
  const result = isRecord(response.result) ? response.result : {};
  const values = result[key];
  return Array.isArray(values) ? values : [];
}

function buildVerificationResult(
  transport: 'streamable_http' | 'http_sse_compat',
  tools: unknown[],
  resources: unknown[],
  prompts: unknown[],
) {
  const discoveredTools = normalizeRemoteMcpToolSnapshot(tools);
  const discoveredResources = normalizeRemoteMcpResourceSnapshot(resources);
  const discoveredPrompts = normalizeRemoteMcpPromptSnapshot(prompts);

  return {
    verification_status: 'verified' as const,
    verification_error: null,
    verified_transport: transport,
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

function readSnapshotList(
  result: Record<string, unknown>,
  key: 'tools' | 'resources' | 'prompts',
) {
  const value = result[key];
  return Array.isArray(value) ? value : [];
}

function isLegacyFallbackCandidate(error: unknown) {
  return error instanceof StreamableTransportError
    && [400, 404, 405].includes(error.status);
}
