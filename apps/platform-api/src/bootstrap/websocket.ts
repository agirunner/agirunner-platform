import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';

import { parseBearerToken, type ApiKeyIdentity, verifyApiKey } from '../auth/api-key.js';
import { verifyJwt } from '../auth/jwt.js';

function writeUnauthorized(socket: import('node:stream').Duplex): void {
  socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
  socket.destroy();
}

async function authenticateUpgrade(app: FastifyInstance, authorization?: string): Promise<ApiKeyIdentity | null> {
  if (!authorization) {
    return null;
  }

  try {
    const token = parseBearerToken(authorization);
    if (token.startsWith('ab_')) {
      return verifyApiKey(app.pgPool, token);
    }

    const claims = await verifyJwt<{
      keyId: string;
      tenantId: string;
      scope: 'agent' | 'worker' | 'admin';
      ownerType: string;
      ownerId: string | null;
      keyPrefix: string;
    }>(app, token);

    return {
      id: claims.keyId,
      tenantId: claims.tenantId,
      scope: claims.scope,
      ownerType: claims.ownerType,
      ownerId: claims.ownerId,
      keyPrefix: claims.keyPrefix,
    };
  } catch {
    return null;
  }
}

/**
 * FR-820 — External workers run anywhere.
 *
 * Checks whether the Origin header of an upgrade request is allowed by the
 * configured WORKER_ALLOWED_ORIGINS list.  When the value is '*', every
 * origin is permitted so workers can connect from any network location.
 *
 * Exported for unit-testing the actual function — tests must not re-implement
 * this logic inline.
 */
export function isOriginAllowed(origin: string | undefined, allowedOriginsConfig: string): boolean {
  if (allowedOriginsConfig === '*') {
    return true;
  }

  if (!origin) {
    // No Origin header — native TCP clients (e.g. SDK / CLI) are always allowed.
    return true;
  }

  const allowed = allowedOriginsConfig.split(',').map((o) => o.trim().toLowerCase());
  return allowed.includes(origin.toLowerCase());
}

export function registerWebsocketGateway(app: FastifyInstance): void {
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    if (url.pathname !== app.config.WORKER_WEBSOCKET_PATH) {
      return;
    }

    // FR-820: Enforce network-transparent origin policy.
    const origin = request.headers.origin;
    if (!isOriginAllowed(origin, app.config.WORKER_ALLOWED_ORIGINS)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const identity = await authenticateUpgrade(app, request.headers.authorization);
    if (!identity) {
      writeUnauthorized(socket);
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('error', () => ws.close());
      let workerId: string | null = null;

      if (identity.scope === 'worker' && identity.ownerId) {
        workerId = identity.ownerId;
        app.workerConnectionHub.registerWorker(workerId, identity.tenantId, ws);
        void app.pgPool
          .query(
            `UPDATE workers
             SET connected_at = now(),
                 status = CASE WHEN status = 'draining' THEN status ELSE 'online' END
             WHERE tenant_id = $1 AND id = $2`,
            [identity.tenantId, workerId],
          )
          .catch((error) => app.log.error({ err: error, workerId, tenantId: identity.tenantId }, 'worker_connected_state_update_failed'));
      }

      ws.send(
        JSON.stringify({
          type: 'connection.ready',
          reconnect: {
            strategy: 'exponential_backoff',
            min_ms: app.config.WORKER_RECONNECT_MIN_MS,
            max_ms: app.config.WORKER_RECONNECT_MAX_MS,
            jitter: true,
          },
        }),
      );

      ws.on('message', (raw) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        if (payload.type === 'task.assignment_ack' && typeof payload.task_id === 'string') {
          void app.workerService.acknowledgeTask(
            identity,
            payload.task_id,
            typeof payload.agent_id === 'string' ? payload.agent_id : undefined,
          );
          return;
        }

        if (payload.type === 'signal.ack' && workerId && typeof payload.signal_id === 'string') {
          void app.workerService.acknowledgeSignal(identity, workerId, payload.signal_id);
          return;
        }

        if (payload.type === 'worker.heartbeat' && workerId) {
          void app.workerService.heartbeat(identity, workerId, {
            status: payload.status as 'online' | 'busy' | 'draining' | 'disconnected' | 'offline' | undefined,
            current_task_id: typeof payload.current_task_id === 'string' ? payload.current_task_id : null,
            metrics: (payload.metrics as Record<string, unknown> | undefined) ?? {},
          });
        }
      });

      ws.on('close', () => {
        if (workerId) {
          app.workerConnectionHub.unregisterWorker(workerId);
          void app.pgPool
            .query(`UPDATE workers SET status = 'offline' WHERE tenant_id = $1 AND id = $2`, [identity.tenantId, workerId])
            .catch((error) => app.log.error({ err: error, workerId, tenantId: identity.tenantId }, 'worker_disconnected_state_update_failed'));
        }
      });

      ws.on('pong', () => {
        (ws as unknown as { isAlive?: boolean }).isAlive = true;
      });
      (ws as unknown as { isAlive?: boolean }).isAlive = true;
    });
  });

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      const state = ws as unknown as { isAlive?: boolean; terminate: () => void; ping: () => void };
      if (!state.isAlive) {
        state.terminate();
        continue;
      }
      state.isAlive = false;
      state.ping();
    }
  }, app.config.WORKER_WEBSOCKET_PING_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(pingTimer);
    wss.close();
  });
}
