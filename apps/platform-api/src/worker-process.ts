/**
 * Standalone worker entry point — FR-741
 *
 * Launch this process independently from the API server:
 *
 *   node dist/worker-process.js
 *   # or via package script:
 *   pnpm worker
 *
 * Required environment variables:
 *   PLATFORM_API_URL   — base URL of the running Platform API
 *   PLATFORM_API_KEY   — admin API key to register this worker
 *
 * Optional:
 *   WORKER_NAME        — display name (default: "built-in-worker")
 *   WORKER_CAPS        — comma-separated capabilities list
 *   WORKER_HB_SECS     — heartbeat interval in seconds (default: 30)
 */

import { connectBuiltInWorkerWebSocket, registerBuiltInWorker } from './bootstrap/built-in-worker.js';

const API_URL = process.env.PLATFORM_API_URL ?? 'http://localhost:8080';
const API_KEY = process.env.PLATFORM_API_KEY ?? '';
const WORKER_NAME = process.env.WORKER_NAME ?? 'built-in-worker';
const CAPABILITIES = (process.env.WORKER_CAPS ?? 'general').split(',').map((cap) => cap.trim());
const HEARTBEAT_SECS = Number(process.env.WORKER_HB_SECS ?? 30);

if (!API_KEY) {
  console.error('[built-in-worker] PLATFORM_API_KEY is required');
  process.exit(1);
}

async function run(): Promise<void> {
  console.info(`[built-in-worker] Registering with ${API_URL} as "${WORKER_NAME}"…`);

  const registration = await registerBuiltInWorker({
    apiBaseUrl: API_URL,
    adminApiKey: API_KEY,
    capabilities: CAPABILITIES,
    name: WORKER_NAME,
    heartbeatIntervalSeconds: HEARTBEAT_SECS,
  });

  console.info(`[built-in-worker] Registered as worker ${registration.workerId}. Connecting…`);

  const disconnect = connectBuiltInWorkerWebSocket(
    registration,
    { apiBaseUrl: API_URL },
    async (task) => {
      // Default no-op handler: the platform marks the task running and waits.
      // Real implementations plug in LLM adapters or script runners here.
      console.info(`[built-in-worker] Task received: ${String(task.id)}`);
    },
  );

  const shutdown = (): void => {
    console.info('[built-in-worker] Shutting down…');
    disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.info('[built-in-worker] Ready. Waiting for tasks…');
}

run().catch((error) => {
  console.error('[built-in-worker] Fatal error:', error);
  process.exit(1);
});
