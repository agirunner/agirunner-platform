import type { ApiDataResponse, AuthTokenResponse } from '../types.js';
import type { ClientTransport } from './core.js';

export async function exchangeApiKey(
  transport: ClientTransport,
  apiKey: string,
  persistentSession = true,
): Promise<AuthTokenResponse> {
  const response = await transport.request<ApiDataResponse<AuthTokenResponse>>('/api/v1/auth/token', {
    method: 'POST',
    body: {
      api_key: apiKey,
      persistent_session: persistentSession,
    },
    includeAuth: false,
  });
  return response.data;
}

export async function refreshSession(transport: ClientTransport): Promise<{ token: string }> {
  const response = await transport.request<ApiDataResponse<{ token: string }>>('/api/v1/auth/refresh', {
    method: 'POST',
    includeAuth: false,
  });
  return response.data;
}
