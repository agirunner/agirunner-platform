import { ValidationError } from '../../errors/domain-errors.js';

import {
  JSON_RPC_VERSION,
  MCP_PROTOCOL_VERSION,
} from './constants.js';
import { buildRequestHeaders, isOptionalListFailure } from './shared.js';
import { readJsonRpcResponse } from './sse.js';
import type { JsonRpcResponsePayload } from './types.js';

export class StreamableTransportError extends ValidationError {
  constructor(readonly status: number) {
    super(readStreamableTransportFailureMessage(status));
  }
}

export async function postJsonRpc(
  endpointUrl: string,
  headers: Record<string, string>,
  timeoutSeconds: number,
  id: number,
  method: string,
  params: Record<string, unknown>,
  sessionId: string | null,
): Promise<JsonRpcResponsePayload> {
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

export async function postOptionalJsonRpc(
  endpointUrl: string,
  headers: Record<string, string>,
  timeoutSeconds: number,
  id: number,
  method: string,
  params: Record<string, unknown>,
  sessionId: string | null,
  supported: boolean,
): Promise<JsonRpcResponsePayload> {
  if (!supported) {
    return { result: {}, sessionId };
  }
  try {
    return await postJsonRpc(endpointUrl, headers, timeoutSeconds, id, method, params, sessionId);
  } catch (error) {
    if (isOptionalListFailure(error)) {
      return { result: {}, sessionId };
    }
    throw error;
  }
}

export const postLegacyJsonRpc = {
  async openStream(
    endpointUrl: string,
    headers: Record<string, string>,
    timeoutSeconds: number,
  ) {
    const response = await fetchWithTimeout(endpointUrl, timeoutSeconds, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        ...headers,
      },
    });
    if (!response.ok) {
      throw new ValidationError(
        `Remote MCP legacy SSE verification failed with status ${response.status}`,
      );
    }
    return response;
  },
  async send(
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
  },
};

export async function postNotification(
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

function readStreamableTransportFailureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return `Remote MCP authentication failed with status ${status}. Check the configured authentication parameters and secret values.`;
  }
  return `Remote MCP streamable HTTP verification failed with status ${status}`;
}
