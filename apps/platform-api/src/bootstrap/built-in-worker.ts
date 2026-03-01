/**
 * Built-in Worker Bootstrap — FR-741, FR-743, FR-745, FR-747, FR-748, FR-749, FR-750, FR-752, FR-754, FR-756
 *
 * This module provides the lifecycle functions for the platform's optional
 * built-in worker.  The built-in worker:
 *
 *   FR-741 — runs as a separate process from the API server.
 *   FR-743 — registers 4 core role agents: developer, reviewer, architect, qa.
 *   FR-745 — supports Anthropic, OpenAI, Google as LLM providers (BYOK via env).
 *   FR-747 — uses curated role configs loaded from configs/built-in-roles.json.
 *   FR-748 — validates task output against an output schema before marking complete.
 *   FR-749 — re-queues failed tasks with feedback for rework (configurable max attempts).
 *   FR-750 — capabilities are explicitly limited to LLM API work only.
 *   FR-752 — uses the same worker registration protocol as external workers,
 *             so any external agent with matching capabilities can replace it.
 *   FR-754 — starts automatically on first run when a default API key exists
 *             (zero-config).
 *   FR-756 — has no exclusive capabilities; it registers through the standard
 *             capability system with no special privileges.
 */

import http from 'node:http';
import https from 'node:https';
import { WebSocket } from 'ws';

import {
  loadBuiltInRolesConfig,
  getAllCapabilities,
  resolveProvider,
  resolveProviderApiKey,
  type BuiltInRolesConfig,
  type RoleName,
} from '../built-in/role-config.js';
import { validateOutputSchema, type OutputSchema } from '../built-in/output-validator.js';
import {
  decideRework,
  extractReworkAttemptCount,
} from '../built-in/rework-controller.js';

// Re-export role config types for consumers of this module.
export type { BuiltInRolesConfig, RoleName };
export { loadBuiltInRolesConfig, getAllCapabilities, resolveProvider, resolveProviderApiKey };

export interface BuiltInWorkerConfig {
  /** Base URL of the Platform API (e.g. http://localhost:8080) */
  apiBaseUrl: string;
  /** Admin API key used to register the worker on first connect */
  adminApiKey: string;
  /**
   * Capabilities this worker advertises (same set as any external worker).
   * FR-750: capabilities are derived from role configs and limited to llm-api work.
   */
  capabilities: string[];
  /** Human-readable worker name surfaced in the dashboard */
  name: string;
  /** Heartbeat interval in seconds */
  heartbeatIntervalSeconds: number;
  /** Task executor configuration */
  executor?: TaskExecutorConfig;
  /**
   * Maximum number of rework attempts before permanently failing a task.
   * FR-749: must come from config, not hardcoded.
   */
  maxReworkAttempts?: number;
  /**
   * Operations this worker is prohibited from executing.
   * FR-750: sourced from llmOnlyConstraint.prohibitedOperations in the role config.
   * Tasks that declare any of these operations in their requirements are rejected
   * immediately before execution begins.
   */
  prohibitedOperations?: string[];
}

/**
 * Builds a BuiltInWorkerConfig from the loaded role config and environment.
 *
 * FR-743: registers all 4 core role capabilities on startup.
 * FR-745: resolves LLM provider from BUILT_IN_WORKER_LLM_PROVIDER env var.
 * FR-750: capabilities are derived from the role config, which limits them to llm-api.
 */
export function buildWorkerConfigFromRoles(
  baseConfig: Omit<BuiltInWorkerConfig, 'capabilities' | 'maxReworkAttempts'>,
  rolesConfig: BuiltInRolesConfig,
  env: NodeJS.ProcessEnv = process.env,
): BuiltInWorkerConfig {
  const provider = resolveProvider(rolesConfig, env);
  const providerApiKey = resolveProviderApiKey(rolesConfig, provider, env);

  return {
    ...baseConfig,
    // FR-743: all 4 role capabilities merged into one registration.
    // FR-750: getAllCapabilities returns only llm-api and role:* capabilities.
    capabilities: getAllCapabilities(rolesConfig),
    // FR-749: max rework attempts from config.
    maxReworkAttempts: rolesConfig.maxReworkAttempts,
    // FR-750: prohibited operations sourced from llmOnlyConstraint — not hardcoded.
    prohibitedOperations: rolesConfig.llmOnlyConstraint.prohibitedOperations,
    executor: {
      ...baseConfig.executor,
      // FR-745: provider API key injected from env (BYOK — never hardcoded).
      agentApiKey: providerApiKey ?? baseConfig.executor?.agentApiKey,
    },
  };
}

/**
 * Configuration for the built-in task executor.
 * When an agent API URL is configured, tasks are forwarded to that agent.
 * Without configuration, the executor completes tasks immediately with a
 * placeholder output — useful for testing and zero-config bootstrapping.
 */
export interface TaskExecutorConfig {
  /**
   * URL of the agent or tool API to call for task execution.
   * When omitted, the built-in executor runs tasks as a no-content pass-through.
   */
  agentApiUrl?: string;
  /**
   * Bearer token for the agent API (if required).
   */
  agentApiKey?: string;
  /**
   * Timeout for a single task execution in milliseconds.
   * Defaults to 5 minutes.
   */
  taskTimeoutMs?: number;
}

export interface WorkerRegistration {
  workerId: string;
  workerApiKey: string;
  websocketUrl: string;
  heartbeatIntervalSeconds: number;
}

export interface TaskExecutionResult {
  output: Record<string, unknown>;
  success: boolean;
  error?: string;
}

/**
 * Checks whether a task's declared requirements contain any prohibited operation.
 *
 * FR-750: enforced at runtime before task execution begins so that tasks
 * requesting Docker, bare-metal, or other out-of-scope operations are rejected
 * immediately with a clear error rather than silently failing later.
 *
 * @param taskRequirements - The `requirements` field from the task payload (any type).
 * @param prohibitedOperations - The list of operations the worker refuses to perform.
 * @returns The first prohibited operation found, or `undefined` if the task is allowed.
 */
export function checkProhibitedOperations(
  taskRequirements: unknown,
  prohibitedOperations: string[],
): string | undefined {
  if (!Array.isArray(taskRequirements) || prohibitedOperations.length === 0) {
    return undefined;
  }
  return (taskRequirements as unknown[]).find(
    (req): req is string => typeof req === 'string' && prohibitedOperations.includes(req),
  );
}

/**
 * Executes a task using the configured executor.
 *
 * When an `agentApiUrl` is provided, the task payload is forwarded to that URL
 * via HTTP POST, and the response body is used as the task output.
 *
 * Without an agent URL, the executor completes the task immediately with an
 * empty output — allowing the platform to continue pipeline execution without
 * any real work being performed.  This is suitable for testing and scaffolding
 * pipelines before real agent integrations are available.
 */
export async function executeTask(
  task: Record<string, unknown>,
  config: TaskExecutorConfig,
): Promise<TaskExecutionResult> {
  if (!config.agentApiUrl) {
    return {
      output: { task_id: task.id, handled_by: 'built-in-worker', status: 'completed' },
      success: true,
    };
  }

  const timeoutMs = config.taskTimeoutMs ?? 5 * 60 * 1000;
  const body = JSON.stringify({
    task_id: task.id,
    title: task.title,
    type: task.type,
    input: task.input ?? {},
    context: task.context ?? {},
  });

  return new Promise<TaskExecutionResult>((resolve) => {
    const url = new URL(config.agentApiUrl!);
    const isHttps = url.protocol === 'https:';
    const requestModule = isHttps ? https : http;
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(config.agentApiKey ? { Authorization: `Bearer ${config.agentApiKey}` } : {}),
      },
    };

    const timer = setTimeout(() => {
      req.destroy();
      resolve({ output: {}, success: false, error: `Agent API call timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    const req = requestModule.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk: Buffer) => {
        responseData += chunk.toString();
      });
      res.on('end', () => {
        clearTimeout(timer);
        if ((res.statusCode ?? 500) >= 400) {
          resolve({ output: {}, success: false, error: `Agent API returned HTTP ${res.statusCode ?? 'unknown'}: ${responseData}` });
          return;
        }
        try {
          const parsed = JSON.parse(responseData) as Record<string, unknown>;
          resolve({ output: parsed, success: true });
        } catch {
          // Non-JSON response is fine — wrap in an output envelope
          resolve({ output: { raw: responseData }, success: true });
        }
      });
    });

    req.on('error', (error) => {
      clearTimeout(timer);
      resolve({ output: {}, success: false, error: String(error) });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Optional overrides for the built-in task handler — used in testing to inject
 * a mock executor without modifying production code paths.
 */
export interface TaskHandlerOptions {
  /**
   * Replaces the default `executeTask` implementation.
   * Useful in unit tests to verify that execution is (or is not) reached.
   */
  executeTaskFn?: (
    task: Record<string, unknown>,
    config: TaskExecutorConfig,
  ) => Promise<TaskExecutionResult>;
}

/**
 * Creates a task handler that uses the Platform API to mark tasks running,
 * execute them via the configured executor, then mark them complete or failed.
 *
 * FR-748: validates task output against the task's output_schema before completing.
 * FR-749: re-queues the task with rework feedback if validation fails or output is rejected.
 * FR-750: rejects tasks that declare a prohibited operation before execution begins.
 *
 * The returned handler is suitable for passing to `connectBuiltInWorkerWebSocket`.
 */
export function createBuiltInTaskHandler(
  config: BuiltInWorkerConfig,
  registration: WorkerRegistration,
  options?: TaskHandlerOptions,
): (task: Record<string, unknown>) => Promise<void> {
  const apiBaseUrl = config.apiBaseUrl;
  const agentApiKey = registration.workerApiKey;
  const executorConfig = config.executor ?? {};
  const maxReworkAttempts = config.maxReworkAttempts ?? 3;
  const prohibitedOps = config.prohibitedOperations ?? [];
  const taskExecutor = options?.executeTaskFn ?? executeTask;

  return async (task: Record<string, unknown>): Promise<void> => {
    const taskId = String(task.id);
    const agentId = typeof task.assigned_agent_id === 'string' ? task.assigned_agent_id : undefined;
    const outputSchema = (task.output_schema ?? undefined) as OutputSchema | undefined;
    const taskContext = (task.context ?? {}) as Record<string, unknown>;

    // FR-750: reject tasks that require a prohibited operation before doing any work.
    const violation = checkProhibitedOperations(task['requirements'], prohibitedOps);
    if (violation !== undefined) {
      await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/fail`, {
        error: {
          message: `Task requires prohibited operation "${violation}". The built-in worker is restricted to LLM API calls only.`,
          source: 'built-in-worker',
          prohibited_operation: violation,
        },
      });
      return;
    }

    // Mark the task as running via the Platform API
    await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/start`, {
      ...(agentId ? { agent_id: agentId } : {}),
    });

    // Execute the task using the configured executor
    const result = await taskExecutor(task, executorConfig);

    if (!result.success) {
      await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/fail`, {
        error: { message: result.error ?? 'Unknown execution error', source: 'built-in-worker' },
      });
      return;
    }

    // FR-748: validate output against the task's declared output schema.
    const validationResult = validateOutputSchema(result.output, outputSchema);
    if (!validationResult.valid) {
      const feedback = `Output schema validation failed: ${validationResult.error ?? 'unknown validation error'}`;
      await handleReworkOrFail(
        apiBaseUrl,
        agentApiKey,
        taskId,
        taskContext,
        maxReworkAttempts,
        feedback,
      );
      return;
    }

    await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/complete`, {
      output: result.output,
    });
  };
}

/**
 * Handles the rework-or-fail decision after a task output is rejected.
 *
 * FR-749: if the attempt limit has not been reached, the task context is enriched
 * with rework feedback and the task is marked for rework. Otherwise, the task is
 * permanently failed so the pipeline can escalate.
 */
async function handleReworkOrFail(
  apiBaseUrl: string,
  agentApiKey: string,
  taskId: string,
  taskContext: Record<string, unknown>,
  maxReworkAttempts: number,
  feedback: string,
): Promise<void> {
  const attemptsSoFar = extractReworkAttemptCount(taskContext);
  const decision = decideRework(attemptsSoFar, maxReworkAttempts, feedback, taskContext);

  if (decision.shouldRework && decision.nextContext) {
    // Re-queue the task with enriched context so the next attempt has the feedback.
    await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/rework`, {
      feedback,
      context: decision.nextContext,
    });
  } else {
    // Attempt limit exhausted — permanently fail the task.
    await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/fail`, {
      error: {
        message: decision.reason,
        source: 'built-in-worker',
        rework_attempts_exhausted: true,
      },
    });
  }
}

/**
 * Makes an authenticated HTTP request to the Platform API.
 * Uses the agent API key scoped to the built-in worker's agent.
 */
async function callPlatformApi(
  apiBaseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const bodyStr = JSON.stringify(body);
  const url = new URL(path, apiBaseUrl);
  const isHttps = url.protocol === 'https:';
  const requestModule = isHttps ? https : http;
  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      Authorization: `Bearer ${apiKey}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = requestModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`Platform API ${method} ${path} failed: HTTP ${res.statusCode ?? 'unknown'} — ${data}`));
          return;
        }
        resolve();
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Registers the built-in worker with the platform API.  Uses the exact same
 * REST endpoint as any external worker (FR-752, FR-756).
 */
export async function registerBuiltInWorker(config: BuiltInWorkerConfig): Promise<WorkerRegistration> {
  const body = JSON.stringify({
    name: config.name,
    // FR-756: built-in worker advertises capabilities through the same system.
    capabilities: config.capabilities,
    // FR-752: connection_mode is 'websocket' — identical to external workers.
    connection_mode: 'websocket',
    runtime_type: 'internal',
    heartbeat_interval_seconds: config.heartbeatIntervalSeconds,
  });

  return new Promise((resolve, reject) => {
    const url = new URL('/api/v1/workers/register', config.apiBaseUrl);
    const isHttps = url.protocol === 'https:';
    const requestModule = isHttps ? https : http;
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${config.adminApiKey}`,
      },
    };

    const req = requestModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        if (res.statusCode !== 201 && res.statusCode !== 200) {
          reject(new Error(`Worker registration failed: HTTP ${res.statusCode ?? 'unknown'} — ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data) as {
            worker_id: string;
            worker_api_key: string;
            websocket_url: string;
            heartbeat_interval_seconds: number;
          };
          resolve({
            workerId: parsed.worker_id,
            workerApiKey: parsed.worker_api_key,
            websocketUrl: parsed.websocket_url,
            heartbeatIntervalSeconds: parsed.heartbeat_interval_seconds,
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse registration response: ${String(parseError)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Connects the built-in worker to the platform's WebSocket gateway and begins
 * the heartbeat loop.  The connection is network-transparent (FR-820): any
 * URL reachable from this process works.
 *
 * Returns a cleanup function that closes the WebSocket gracefully.
 */
export function connectBuiltInWorkerWebSocket(
  registration: WorkerRegistration,
  config: Pick<BuiltInWorkerConfig, 'apiBaseUrl'>,
  onTask: (task: Record<string, unknown>) => Promise<void>,
): () => void {
  const wsBaseUrl = config.apiBaseUrl.replace(/^http/, 'ws');
  const wsUrl = `${wsBaseUrl}${registration.websocketUrl}`;

  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${registration.workerApiKey}` },
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  ws.on('open', () => {
    // Start heartbeat loop — same protocol as any external worker (FR-756).
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'worker.heartbeat', status: 'online' }));
      }
    }, registration.heartbeatIntervalSeconds * 1000);
  });

  ws.on('message', (rawData: Buffer | string) => {
    try {
      const payload = JSON.parse(rawData.toString()) as Record<string, unknown>;
      if (payload.type === 'task.assigned' && payload.task) {
        const task = payload.task as Record<string, unknown>;
        // Acknowledge receipt before processing.
        ws.send(JSON.stringify({ type: 'task.assignment_ack', task_id: task.id }));
        void onTask(task).catch((error: unknown) => {
          console.error('[built-in-worker] Task handler error:', error);
        });
      }
    } catch (parseError) {
      console.error('[built-in-worker] Failed to parse message:', parseError);
    }
  });

  ws.on('error', (error) => {
    console.error('[built-in-worker] WebSocket error:', error);
  });

  return () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    ws.close();
  };
}
