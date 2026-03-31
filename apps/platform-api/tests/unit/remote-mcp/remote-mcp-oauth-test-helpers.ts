import { expect } from 'vitest';

import type { RemoteMcpOAuthStartResult } from '../../../src/services/remote-mcp-oauth-types.js';

export function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({
      'content-type': 'application/json',
      ...headers,
    }),
  } as Response;
}

export function mockTextResponse(status: number, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => '',
    headers: new Headers(headers ?? {}),
  } as unknown as Response;
}

export function expectBrowserAuthorizationResult(
  result: RemoteMcpOAuthStartResult,
  draftId: string,
): Extract<RemoteMcpOAuthStartResult, { kind: 'browser' }> {
  expect(result.kind).toBe('browser');
  if (result.kind !== 'browser') {
    throw new Error(`Expected browser OAuth result, received ${result.kind}`);
  }
  expect(result.draftId).toBe(draftId);
  return result;
}
