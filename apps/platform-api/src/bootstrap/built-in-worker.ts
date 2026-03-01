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
}

export interface WorkerRegistration {
  workerId: string;
  workerApiKey: string;
  websocketUrl: string;
  heartbeatIntervalSeconds: number;
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
    runtime_type: 'built_in',
    heartbeat_interval_seconds: config.heartbeatIntervalSeconds,
  });

  return new Promise((resolve, reject) => {
    const url = new URL('/api/v1/workers/register', config.apiBaseUrl);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${config.adminApiKey}`,
      },
    };

    const req = http.request(options, (res) => {
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
