import { ValidationError } from '../../errors/domain-errors.js';

import {
  CLIENT_NAME,
  CLIENT_VERSION,
  MCP_PROTOCOL_VERSION,
} from './constants.js';
import type {
  CapabilityFlags,
  ResolvedConnection,
  VerifyRequest,
} from './types.js';

export function resolveConnection(input: VerifyRequest): ResolvedConnection {
  const endpoint = new URL(input.endpointUrl);
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  const initializeParams: Record<string, string> = {};

  for (const parameter of input.parameters) {
    const value = parameter.value.trim();
    if (!value) {
      continue;
    }
    if (shouldSkipTransportParameter(parameter.placement)) {
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

export function buildInitializeParams(
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

export function buildRequestHeaders(
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

export function readCapabilityFlags(value: unknown): CapabilityFlags {
  const capabilities = isRecord(value) ? value : {};
  return {
    tools: capabilities.tools === undefined ? true : capabilities.tools !== null && capabilities.tools !== false,
    resources: capabilities.resources !== undefined && capabilities.resources !== null && capabilities.resources !== false,
    prompts: capabilities.prompts !== undefined && capabilities.prompts !== null && capabilities.prompts !== false,
  };
}

export function isOptionalListFailure(error: unknown): boolean {
  if (!(error instanceof ValidationError)) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return normalized.includes('method not found')
    || normalized.includes('not supported')
    || normalized.includes('unsupported');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldSkipTransportParameter(placement: string) {
  return placement === 'authorize_request_query'
    || placement === 'device_request_query'
    || placement === 'device_request_header'
    || placement === 'device_request_body_form'
    || placement === 'device_request_body_json'
    || placement === 'token_request_query'
    || placement === 'token_request_header'
    || placement === 'token_request_body_form'
    || placement === 'token_request_body_json';
}
