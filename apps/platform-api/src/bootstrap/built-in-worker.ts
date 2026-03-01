/**
 * Built-in Worker Bootstrap — FR-741, FR-752, FR-754, FR-756
 *
 * This module provides the lifecycle functions for the platform's optional
 * built-in worker.  The built-in worker:
 *
 *   FR-741 — runs as a separate process from the API server.
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

export interface BuiltInWorkerConfig {
  /** Base URL of the Platform API (e.g. http://localhost:8080) */
  apiBaseUrl: string;
  /** Admin API key used to register the worker on first connect */
  adminApiKey: string;
  /** Capabilities this worker advertises (same set as any external worker) */
  capabilities: string[];
  /** Human-readable worker name surfaced in the dashboard */
  name: string;
  /** Heartbeat interval in seconds */
  heartbeatIntervalSeconds: number;
  /** Task executor configuration */
  executor?: TaskExecutorConfig;
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
 * Creates a task handler that uses the Platform API to mark tasks running,
 * execute them via the configured executor, then mark them complete or failed.
 *
 * The returned handler is suitable for passing to `connectBuiltInWorkerWebSocket`.
 */
export function createBuiltInTaskHandler(
  config: BuiltInWorkerConfig,
  registration: WorkerRegistration,
): (task: Record<string, unknown>) => Promise<void> {
  const apiBaseUrl = config.apiBaseUrl;
  const agentApiKey = registration.workerApiKey;
  const executorConfig = config.executor ?? {};

  return async (task: Record<string, unknown>): Promise<void> => {
    const taskId = String(task.id);
    const agentId = typeof task.assigned_agent_id === 'string' ? task.assigned_agent_id : undefined;

    // Mark the task as running via the Platform API
    await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/start`, {
      ...(agentId ? { agent_id: agentId } : {}),
    });

    // Execute the task using the configured executor
    const result = await executeTask(task, executorConfig);

    if (result.success) {
      await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/complete`, {
        output: result.output,
      });
    } else {
      await callPlatformApi(apiBaseUrl, agentApiKey, 'POST', `/api/v1/tasks/${taskId}/fail`, {
        error: { message: result.error ?? 'Unknown execution error', source: 'built-in-worker' },
      });
    }
  };
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
