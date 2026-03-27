import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteMcpHttpVerifier } from '../../src/services/remote-mcp-http-verifier.js';

describe('RemoteMcpHttpVerifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies streamable HTTP servers and discovers tools from JSON responses', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe('https://mcp.example.test/mcp');
      expect(init?.method).toBe('POST');
      const payload = JSON.parse(String(init?.body));
      if (payload.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: 'Docs', version: '1.0.0' },
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'mcp-session-id': 'session-1',
            },
          },
        );
      }
      if (payload.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      if (payload.method === 'tools/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              tools: [
                {
                  name: 'search',
                  description: 'Search docs',
                  inputSchema: { type: 'object' },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new Error(`unexpected payload ${JSON.stringify(payload)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const verifier = new RemoteMcpHttpVerifier();
    const result = await verifier.verify({
      endpointUrl: 'https://mcp.example.test/mcp',
      callTimeoutSeconds: 300,
      authMode: 'none',
      parameters: [],
    });

    expect(result.verified_transport).toBe('streamable_http');
    expect(result.discovered_tools_snapshot).toEqual([
      expect.objectContaining({
        original_name: 'search',
        description: 'Search docs',
      }),
    ]);
  });

  it('falls back to legacy HTTP+SSE when streamable HTTP initialize is rejected', async () => {
    const legacySse = [
      'event: endpoint',
      'data: /message',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"Docs","version":"1.0.0"}}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search","description":"Search docs","inputSchema":{"type":"object"}}]}}',
      '',
    ].join('\n');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://mcp.example.test/mcp' && init?.method === 'POST') {
        return new Response('not supported', { status: 405 });
      }
      if (url === 'https://mcp.example.test/mcp' && init?.method === 'GET') {
        return new Response(legacySse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      if (url === 'https://mcp.example.test/message' && init?.method === 'POST') {
        return new Response('', { status: 202 });
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const verifier = new RemoteMcpHttpVerifier();
    const result = await verifier.verify({
      endpointUrl: 'https://mcp.example.test/mcp',
      callTimeoutSeconds: 300,
      authMode: 'none',
      parameters: [],
    });

    expect(result.verified_transport).toBe('http_sse_compat');
    expect(result.discovered_tools_snapshot).toEqual([
      expect.objectContaining({
        original_name: 'search',
        description: 'Search docs',
      }),
    ]);
  });

  it('verifies servers that expose resources and prompts even when tools are empty', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe('https://mcp.example.test/mcp');
      expect(init?.method).toBe('POST');
      const payload = JSON.parse(String(init?.body));
      if (payload.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {
                tools: { listChanged: true },
                resources: { listChanged: true },
                prompts: { listChanged: true },
              },
              serverInfo: { name: 'Docs', version: '1.0.0' },
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'mcp-session-id': 'session-2',
            },
          },
        );
      }
      if (payload.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      if (payload.method === 'tools/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              tools: [],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (payload.method === 'resources/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              resources: [
                {
                  uri: 'docs://guides/getting-started',
                  name: 'Getting Started',
                  description: 'Docs resource',
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (payload.method === 'prompts/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              prompts: [
                {
                  name: 'summarize_docs',
                  description: 'Summarize a docs page',
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new Error(`unexpected payload ${JSON.stringify(payload)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const verifier = new RemoteMcpHttpVerifier();
    const result = await verifier.verify({
      endpointUrl: 'https://mcp.example.test/mcp',
      callTimeoutSeconds: 300,
      authMode: 'none',
      parameters: [],
    });

    expect(result.discovered_tools_snapshot).toEqual([]);
    expect(result.discovered_resources_snapshot).toEqual([
      expect.objectContaining({
        uri: 'docs://guides/getting-started',
        name: 'Getting Started',
      }),
    ]);
    expect(result.discovered_prompts_snapshot).toEqual([
      expect.objectContaining({
        name: 'summarize_docs',
        description: 'Summarize a docs page',
      }),
    ]);
    expect(result.verified_capability_summary).toEqual(
      expect.objectContaining({
        tool_count: 0,
        resource_count: 1,
        prompt_count: 1,
      }),
    );
  });
});
