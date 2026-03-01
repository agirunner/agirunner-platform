import { stdin } from 'node:process';

import { PlatformApiClient } from '@agentbaton/sdk';

import { McpStdioServer } from './dispatcher.js';
import { createMessageProcessor, writeMessage } from './transport.js';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function startMcpServer(): void {
  const apiUrl = getRequiredEnv('PLATFORM_API_URL');
  const accessToken = getRequiredEnv('PLATFORM_API_TOKEN');
  const client = new PlatformApiClient({ baseUrl: apiUrl, accessToken });
  const server = new McpStdioServer(client);

  stdin.on(
    'data',
    createMessageProcessor(
      async (request) => {
        const response = await server.handle(request);
        if (request.id !== undefined) writeMessage(response);
      },
      (errorResponse) => writeMessage(errorResponse),
    ),
  );
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  startMcpServer();
}

export { McpStdioServer } from './dispatcher.js';
export { createMessageProcessor } from './transport.js';
