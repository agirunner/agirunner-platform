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
 *   AGENT_API_URL      — URL of the agent/LLM API to forward tasks to
 *   AGENT_API_KEY      — bearer token for the agent API
 *   TASK_TIMEOUT_MS    — task execution timeout in milliseconds (default: 300000)
 */

import { connectBuiltInWorkerWebSocket, createBuiltInTaskHandler, registerBuiltInWorker } from './bootstrap/built-in-worker.js';

const API_URL = process.env.PLATFORM_API_URL ?? 'http://localhost:8080';
const API_KEY = process.env.PLATFORM_API_KEY ?? '';
const WORKER_NAME = process.env.WORKER_NAME ?? 'built-in-worker';
const CAPABILITIES = (process.env.WORKER_CAPS ?? 'general').split(',').map((cap) => cap.trim());
const HEARTBEAT_SECS = Number(process.env.WORKER_HB_SECS ?? 30);
const AGENT_API_URL = process.env.AGENT_API_URL;
const AGENT_API_KEY = process.env.AGENT_API_KEY;
const TASK_TIMEOUT_MS = process.env.TASK_TIMEOUT_MS ? Number(process.env.TASK_TIMEOUT_MS) : undefined;

if (!API_KEY) {
  console.error('[built-in-worker] PLATFORM_API_KEY is required');
  process.exit(1);
}

async function run(): Promise<void> {
  console.info(`[built-in-worker] Registering with ${API_URL} as "${WORKER_NAME}"…`);

  const workerConfig = {
    apiBaseUrl: API_URL,
    adminApiKey: API_KEY,
    capabilities: CAPABILITIES,
    name: WORKER_NAME,
    heartbeatIntervalSeconds: HEARTBEAT_SECS,
    executor: {
      agentApiUrl: AGENT_API_URL,
      agentApiKey: AGENT_API_KEY,
      taskTimeoutMs: TASK_TIMEOUT_MS,
    },
  };

  const registration = await registerBuiltInWorker(workerConfig);

  console.info(
    `[built-in-worker] Registered as worker ${registration.workerId} with agent ${registration.agent.agentId}. Connecting…`,
  );

  const taskHandler = createBuiltInTaskHandler(workerConfig, registration);

  const disconnect = connectBuiltInWorkerWebSocket(
    registration,
    { apiBaseUrl: API_URL },
    async (task) => {
      console.info(`[built-in-worker] Handling task ${String(task.id)} (type: ${String(task.type)})`);
      await taskHandler(task);
      console.info(`[built-in-worker] Task ${String(task.id)} completed.`);
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
