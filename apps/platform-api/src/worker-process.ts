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
 *   INTERNAL_WORKER_BACKEND — go-runtime only (default: go-runtime)
 *   RUNTIME_URL        — runtime endpoint for built-in execution (required)
 *   RUNTIME_API_KEY    — bearer token for runtime endpoint
 *   AGENT_API_KEY      — optional LLM API key forwarded to runtime credentials
 *   TASK_TIMEOUT_MS    — task execution timeout in milliseconds (default: 300000)
 *
 * Stage S4 deprecates and disables legacy-node built-in worker mode.
 */

import { connectBuiltInWorkerWebSocket, createBuiltInTaskHandler, registerBuiltInWorker } from './bootstrap/built-in-worker.js';
import { loadBuiltInRolesConfig, resolveProvider, resolveProviderApiKey } from './built-in/role-config.js';
import { internalWorkerBackendSchema } from './built-in/worker-runtime-contract.js';
import { resolveSecretEnv } from './config/secret-env.js';

resolveSecretEnv(
  process.env,
  [
    { envName: 'PLATFORM_API_KEY', required: true, minLength: 20, requireFileInProduction: true },
    { envName: 'RUNTIME_API_KEY', minLength: 20, requireFileInProduction: true },
    { envName: 'AGENT_API_KEY', requireFileInProduction: true },
    { envName: 'OPENAI_API_KEY', requireFileInProduction: true },
    { envName: 'ANTHROPIC_API_KEY', requireFileInProduction: true },
    { envName: 'GOOGLE_API_KEY', requireFileInProduction: true },
  ],
  process.env,
);

const API_URL = process.env.PLATFORM_API_URL ?? 'http://localhost:8080';
const API_KEY = process.env.PLATFORM_API_KEY ?? '';
const WORKER_NAME = process.env.WORKER_NAME ?? 'built-in-worker';
const CAPABILITIES = (process.env.WORKER_CAPS ?? 'general').split(',').map((cap) => cap.trim());
const HEARTBEAT_SECS = Number(process.env.WORKER_HB_SECS ?? 30);
const INTERNAL_WORKER_BACKEND = internalWorkerBackendSchema.parse(
  process.env.INTERNAL_WORKER_BACKEND ?? 'go-runtime',
);
const RUNTIME_URL = process.env.RUNTIME_URL;
const RUNTIME_API_KEY = process.env.RUNTIME_API_KEY;
const TASK_TIMEOUT_MS = process.env.TASK_TIMEOUT_MS ? Number(process.env.TASK_TIMEOUT_MS) : undefined;
const rolesConfig = loadBuiltInRolesConfig();
const provider = resolveProvider(rolesConfig, process.env);
const providerApiKey = resolveProviderApiKey(rolesConfig, provider, process.env) ?? process.env.AGENT_API_KEY;
const providerModel = process.env.BUILT_IN_WORKER_LLM_MODEL ?? rolesConfig.providers[provider].defaultModel;
const defaultRoleConfigs = Object.fromEntries(
  Object.entries(rolesConfig.roles).map(([roleName, roleConfig]) => [
    roleName,
    {
      system_prompt: roleConfig.systemPrompt,
      tools: roleConfig.allowedTools,
    },
  ]),
);

if (!API_KEY) {
  console.error('[built-in-worker] PLATFORM_API_KEY is required');
  process.exit(1);
}

if (!RUNTIME_URL) {
  console.error('[built-in-worker] RUNTIME_URL is required (go-runtime only mode).');
  process.exit(1);
}

async function run(): Promise<void> {
  console.info(
    `[built-in-worker] Registering with ${API_URL} as "${WORKER_NAME}" (backend=${INTERNAL_WORKER_BACKEND})…`,
  );

  console.info(
    `[built-in-worker] Executor endpoint: runtimeUrl=${RUNTIME_URL} (legacy-node deprecated and disabled)`,
  );

  const workerConfig = {
    apiBaseUrl: API_URL,
    adminApiKey: API_KEY,
    capabilities: CAPABILITIES,
    name: WORKER_NAME,
    heartbeatIntervalSeconds: HEARTBEAT_SECS,
    executor: {
      internalWorkerBackend: INTERNAL_WORKER_BACKEND,
      agentApiKey: providerApiKey,
      runtimeUrl: RUNTIME_URL,
      runtimeApiKey: RUNTIME_API_KEY,
      llmProvider: provider,
      llmModel: providerModel,
      defaultRoleConfigs,
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
