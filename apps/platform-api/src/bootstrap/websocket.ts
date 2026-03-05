import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';

import { parseBearerToken, type ApiKeyIdentity, verifyApiKey } from '../auth/api-key.js';
import { verifyJwt } from '../auth/jwt.js';
import { NotFoundError } from '../errors/domain-errors.js';

function writeUnauthorized(socket: import('node:stream').Duplex): void {
  socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
  socket.destroy();
}

function writeForbidden(socket: import('node:stream').Duplex): void {
  socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
  socket.destroy();
}

async function authenticateToken(app: FastifyInstance, token: string): Promise<ApiKeyIdentity | null> {
  try {
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

async function authenticateUpgrade(app: FastifyInstance, authorization?: string): Promise<ApiKeyIdentity | null> {
  if (!authorization) {
    return null;
  }

  try {
    const token = parseBearerToken(authorization);
    return authenticateToken(app, token);
  } catch {
    return null;
  }
}

function isDashboardEventScopeAllowed(identity: ApiKeyIdentity | null): boolean {
  return identity?.scope === 'agent' || identity?.scope === 'admin';
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

export function handleWorkerWebsocketMessageError(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  workerId: string | null,
  action: 'task.assignment_ack' | 'signal.ack' | 'worker.heartbeat',
  error: unknown,
  ws?: { close: () => void },
): void {
  if (error instanceof NotFoundError && workerId) {
    app.log.info(
      {
        err: error,
        tenantId: identity.tenantId,
        workerId,
        action,
      },
      'worker_websocket_reference_not_found',
    );
    app.workerConnectionHub.unregisterWorker(workerId);
    ws?.close();
    return;
  }

  app.log.warn(
    {
      err: error,
      tenantId: identity.tenantId,
      workerId,
      action,
    },
    'worker_websocket_message_failed',
  );
}

export function registerWebsocketGateway(app: FastifyInstance): void {
  const workerWss = new WebSocketServer({ noServer: true });
  const eventWss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const isWorkerPath = url.pathname === app.config.WORKER_WEBSOCKET_PATH;
    const isEventsPath = url.pathname === '/api/v1/events/ws';

    if (!isWorkerPath && !isEventsPath) {
      return;
    }

    if (isWorkerPath) {
      const origin = request.headers.origin;
      if (!isOriginAllowed(origin, app.config.WORKER_ALLOWED_ORIGINS)) {
        writeForbidden(socket);
        return;
      }

      const identity = await authenticateUpgrade(app, request.headers.authorization);
      if (!identity) {
        writeUnauthorized(socket);
        return;
      }

      workerWss.handleUpgrade(request, socket, head, (ws) => {
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
            void app.workerService
              .acknowledgeTask(
                identity,
                payload.task_id,
                typeof payload.agent_id === 'string' ? payload.agent_id : undefined,
              )
              .catch((error) => {
                handleWorkerWebsocketMessageError(
                  app,
                  identity,
                  workerId,
                  'task.assignment_ack',
                  error,
                );
              });
            return;
          }

          if (payload.type === 'signal.ack' && workerId && typeof payload.signal_id === 'string') {
            void app.workerService
              .acknowledgeSignal(identity, workerId, payload.signal_id)
              .catch((error) => {
                handleWorkerWebsocketMessageError(app, identity, workerId, 'signal.ack', error);
              });
            return;
          }

          if (payload.type === 'worker.heartbeat' && workerId) {
            void app.workerService
              .heartbeat(identity, workerId, {
                status: payload.status as 'online' | 'busy' | 'draining' | 'disconnected' | 'offline' | undefined,
                current_task_id: typeof payload.current_task_id === 'string' ? payload.current_task_id : null,
                metrics: (payload.metrics as Record<string, unknown> | undefined) ?? {},
              })
              .catch((error) => {
                handleWorkerWebsocketMessageError(
                  app,
                  identity,
                  workerId,
                  'worker.heartbeat',
                  error,
                  ws,
                );
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

      return;
    }

    const initialIdentity = await authenticateUpgrade(app, request.headers.authorization);
    if (initialIdentity && !isDashboardEventScopeAllowed(initialIdentity)) {
      writeForbidden(socket);
      return;
    }

    eventWss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('error', () => ws.close());
      let identity = initialIdentity;
      let unsubscribe: (() => void) | null = null;

      const subscribeToEvents = (filters: {
        event_types?: string[];
        entity_types?: string[];
        project_id?: string;
        pipeline_id?: string;
      }) => {
        if (!identity) {
          throw new Error('Not authenticated');
        }

        unsubscribe?.();
        unsubscribe = app.eventStreamService.subscribe(
          identity.tenantId,
          {
            types: filters.event_types,
            entityTypes: filters.entity_types,
            projectId: filters.project_id,
            pipelineId: filters.pipeline_id,
          },
          (event) => {
            ws.send(
              JSON.stringify({
                type: 'event',
                event_id: event.id,
                event_type: event.type,
                entity_type: event.entity_type,
                entity_id: event.entity_id,
                data: event.data,
                timestamp: event.created_at,
              }),
            );
          },
        );
      };

      ws.send(
        JSON.stringify({
          type: 'connection.ready',
          protocol: 'event-subscribe-v1',
          requires_authentication: !identity,
        }),
      );

      if (identity) {
        ws.send(JSON.stringify({ type: 'authenticated', scope: identity.scope }));
      }

      ws.on('message', (raw) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_PAYLOAD' }));
          return;
        }

        if (!identity) {
          if (payload.action !== 'authenticate' || typeof payload.token !== 'string') {
            ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Authenticate before subscribe' }));
            return;
          }

          void authenticateToken(app, payload.token)
            .then((resolved) => {
              if (!resolved || !isDashboardEventScopeAllowed(resolved)) {
                ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED' }));
                ws.close();
                return;
              }

              identity = resolved;
              ws.send(JSON.stringify({ type: 'authenticated', scope: identity.scope }));
            })
            .catch(() => {
              ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED' }));
              ws.close();
            });
          return;
        }

        if (payload.action === 'subscribe') {
          const filtersRaw = payload.filters as Record<string, unknown> | undefined;
          const toStringArray = (value: unknown): string[] | undefined =>
            Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : undefined;

          const filters = {
            event_types: toStringArray(filtersRaw?.event_types),
            entity_types: toStringArray(filtersRaw?.entity_types),
            project_id: typeof filtersRaw?.project_id === 'string' ? filtersRaw.project_id : undefined,
            pipeline_id: typeof filtersRaw?.pipeline_id === 'string' ? filtersRaw.pipeline_id : undefined,
          };

          subscribeToEvents(filters);
          ws.send(JSON.stringify({ type: 'subscribed', filters }));
          return;
        }

        if (payload.action === 'unsubscribe') {
          unsubscribe?.();
          unsubscribe = null;
          ws.send(JSON.stringify({ type: 'unsubscribed' }));
          return;
        }

        if (payload.action === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        ws.send(JSON.stringify({ type: 'error', code: 'UNSUPPORTED_ACTION' }));
      });

      ws.on('close', () => {
        unsubscribe?.();
        unsubscribe = null;
      });

      ws.on('pong', () => {
        (ws as unknown as { isAlive?: boolean }).isAlive = true;
      });
      (ws as unknown as { isAlive?: boolean }).isAlive = true;
    });
  });

  const pingTimer = setInterval(() => {
    for (const ws of [...workerWss.clients, ...eventWss.clients]) {
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
    workerWss.close();
    eventWss.close();
  });
}
