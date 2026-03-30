import type {
  RemoteMcpParameterInput,
  RemoteMcpTransportPreference,
} from '../remote-mcp-model.js';

export interface VerifyRequest {
  endpointUrl: string;
  callTimeoutSeconds: number;
  transportPreference?: RemoteMcpTransportPreference;
  authMode: 'none' | 'parameterized' | 'oauth';
  parameters: RemoteMcpParameterInput[];
}

export interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: {
    code?: number;
    message?: string;
  } | null;
}

export interface ResolvedConnection {
  endpointUrl: string;
  headers: Record<string, string>;
  initializeParams: Record<string, string>;
}

export interface CapabilityFlags {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
}

export interface JsonRpcResponsePayload {
  result: Record<string, unknown>;
  sessionId: string | null;
}

export interface SseEvent {
  event: string | null;
  data: string;
  sessionId: string | null;
}
