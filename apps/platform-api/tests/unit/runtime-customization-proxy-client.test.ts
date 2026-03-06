import { createServer, type IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { RuntimeCustomizationProxyClient } from '../../src/runtime/customization-proxy-client.js';

async function withHttpServer(
  handler: (
    request: IncomingMessage,
    body: string,
  ) => { status: number; json?: Record<string, unknown> },
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });

    request.on('end', () => {
      const result = handler(request, body);
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result.json ?? {}));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start HTTP test server');
  }

  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

describe('RuntimeCustomizationProxyClient', () => {
  it('forwards customization requests with X-API-Key auth and JSON payloads', async () => {
    let observedMethod = '';
    let observedPath = '';
    let observedApiKey = '';
    let observedBody: Record<string, unknown> = {};

    await withHttpServer(
      (request, body) => {
        observedMethod = String(request.method ?? '');
        observedPath = String(request.url ?? '');
        observedApiKey = String(request.headers['x-api-key'] ?? '');
        observedBody = JSON.parse(body) as Record<string, unknown>;

        return {
          status: 202,
          json: { build_id: 'build-1', status: 'accepted' },
        };
      },
      async (port) => {
        const client = new RuntimeCustomizationProxyClient({
          runtimeUrl: `http://127.0.0.1:${port}`,
          runtimeApiKey: 'runtime-proxy-secret',
        });

        const response = await client.createBuild({
          manifest: { template: 'base' },
          deployment_target: 'staging',
        });

        expect(response).toEqual({
          statusCode: 202,
          body: { build_id: 'build-1', status: 'accepted' },
        });
      },
    );

    expect(observedMethod).toBe('POST');
    expect(observedPath).toBe('/v1/runtime/customizations/builds');
    expect(observedApiKey).toBe('runtime-proxy-secret');
    expect(observedBody).toEqual({
      manifest: { template: 'base' },
      deployment_target: 'staging',
    });
  });

  it('normalizes runtime URLs that already include a customization path', async () => {
    let observedPath = '';

    await withHttpServer(
      (request) => {
        observedPath = String(request.url ?? '');
        return {
          status: 200,
          json: { state: 'ready' },
        };
      },
      async (port) => {
        const client = new RuntimeCustomizationProxyClient({
          runtimeUrl: `http://127.0.0.1:${port}/v1/runtime/customizations`,
        });

        await client.getStatus();
      },
    );

    expect(observedPath).toBe('/v1/runtime/customizations/status');
  });
});
