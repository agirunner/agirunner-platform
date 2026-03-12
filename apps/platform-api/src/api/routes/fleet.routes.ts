import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
import type {
  CreateDesiredStateInput,
  UpdateDesiredStateInput,
  HeartbeatPayload,
  FleetEventFilters,
} from '../../services/fleet-service.js';

export const fleetRoutes: FastifyPluginAsync = async (app) => {
  const service = app.fleetService;
  const heartbeatSchema = z.object({
    runtime_id: z.string().uuid(),
    playbook_id: z.string().uuid(),
    pool_kind: z.enum(['orchestrator', 'specialist']),
    state: z.enum(['idle', 'executing', 'draining']),
    task_id: z.string().uuid().nullable().optional(),
    uptime_seconds: z.number().int().nonnegative().optional(),
    last_claim_at: z.string().datetime({ offset: true }).nullable().optional(),
    image: z.string().min(1).optional(),
  });
  const actualStateSchema = z
    .object({
      desiredStateId: z.string().uuid().optional(),
      desired_state_id: z.string().uuid().optional(),
      containerId: z.string().min(1).optional(),
      container_id: z.string().min(1).optional(),
      containerStatus: z.string().min(1).optional(),
      container_status: z.string().min(1).optional(),
      cpuUsagePercent: z.number().finite().optional(),
      cpu_usage_percent: z.number().finite().optional(),
      memoryUsageBytes: z.number().int().nonnegative().optional(),
      memory_usage_bytes: z.number().int().nonnegative().optional(),
      networkRxBytes: z.number().int().nonnegative().optional(),
      network_rx_bytes: z.number().int().nonnegative().optional(),
      networkTxBytes: z.number().int().nonnegative().optional(),
      network_tx_bytes: z.number().int().nonnegative().optional(),
    })
    .transform((value) => ({
      desiredStateId: value.desiredStateId ?? value.desired_state_id,
      containerId: value.containerId ?? value.container_id,
      containerStatus: value.containerStatus ?? value.container_status,
      cpuUsagePercent: value.cpuUsagePercent ?? value.cpu_usage_percent,
      memoryUsageBytes: value.memoryUsageBytes ?? value.memory_usage_bytes,
      networkRxBytes: value.networkRxBytes ?? value.network_rx_bytes,
      networkTxBytes: value.networkTxBytes ?? value.network_tx_bytes,
    }))
    .superRefine((value, ctx) => {
      if (!value.desiredStateId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'desiredStateId is required',
          path: ['desiredStateId'],
        });
      }
      if (!value.containerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'containerId is required',
          path: ['containerId'],
        });
      }
      if (!value.containerStatus) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'containerStatus is required',
          path: ['containerStatus'],
        });
      }
    });

  function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
    if (result.success) {
      return result.data;
    }
    throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
  }

  // --- Desired State (Fleet Workers) ---

  app.get(
    '/api/v1/fleet/workers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listWorkers(request.auth!.tenantId) }),
  );

  app.post(
    '/api/v1/fleet/workers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.createWorker(
        request.auth!.tenantId,
        request.body as CreateDesiredStateInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.patch(
    '/api/v1/fleet/workers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateWorker(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateDesiredStateInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/fleet/workers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteWorker(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );

  app.post(
    '/api/v1/fleet/workers/:id/restart',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.restartWorker(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/fleet/workers/:id/drain',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.drainWorker(request.auth!.tenantId, params.id) };
    },
  );

  // --- Containers ---

  app.get(
    '/api/v1/fleet/containers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listContainers(request.auth!.tenantId) }),
  );

  app.get(
    '/api/v1/fleet/containers/:id/stats',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getContainerStats(params.id) };
    },
  );

  app.post(
    '/api/v1/fleet/containers/prune',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const removed = await service.pruneStaleContainers(request.auth!.tenantId);
      reply.status(200);
      return { data: { removed } };
    },
  );

  // --- Actual State (Worker Reports) ---

  app.post(
    '/api/v1/fleet/workers/actual-state',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request, reply) => {
      const body = parseOrThrow(actualStateSchema.safeParse(request.body));
      await service.reportActualState(body.desiredStateId!, body.containerId!, body.containerStatus!, {
        cpuPercent: body.cpuUsagePercent,
        memoryBytes: body.memoryUsageBytes,
        rxBytes: body.networkRxBytes,
        txBytes: body.networkTxBytes,
      });
      reply.status(204);
    },
  );

  // --- Images ---

  app.get(
    '/api/v1/fleet/images',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async () => ({ data: await service.listImages() }),
  );

  app.post(
    '/api/v1/fleet/images',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request, reply) => {
      const body = request.body as {
        repository: string;
        tag?: string;
        digest?: string;
        sizeBytes?: number;
      };
      await service.reportImage(
        body.repository,
        body.tag ?? null,
        body.digest ?? null,
        body.sizeBytes ?? null,
      );
      reply.status(204);
    },
  );

  app.post(
    '/api/v1/fleet/images/pull',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = request.body as { repository: string; tag: string };
      await service.requestImagePull(body.repository, body.tag);
      reply.status(202);
      return { data: { repository: body.repository, tag: body.tag } };
    },
  );

  // --- Dynamic Container Management ---

  app.get(
    '/api/v1/tasks/queue-depth',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      const query = request.query as { playbook_id?: string };
      return { data: await service.getQueueDepth(request.auth!.tenantId, query.playbook_id) };
    },
  );

  app.get(
    '/api/v1/fleet/runtime-targets',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      return { data: await service.getRuntimeTargets(request.auth!.tenantId) };
    },
  );

  app.post(
    '/api/v1/fleet/heartbeat',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      const body = heartbeatSchema.parse(request.body) as HeartbeatPayload;
      const result = await service.recordHeartbeat(request.auth!.tenantId, body);
      return { data: result };
    },
  );

  app.get(
    '/api/v1/fleet/heartbeats',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request) => {
      return { data: await service.listHeartbeats(request.auth!.tenantId) };
    },
  );

  app.get(
    '/api/v1/fleet/status',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      return { data: await service.getFleetStatus(request.auth!.tenantId) };
    },
  );

  app.post(
    '/api/v1/fleet/events',
    { preHandler: [authenticateApiKey, withScope('worker')] },
    async (request, reply) => {
      const body = request.body as {
        event_type: string;
        level?: string;
        runtime_id?: string;
        playbook_id?: string;
        task_id?: string;
        workflow_id?: string;
        container_id?: string;
        payload?: Record<string, unknown>;
      };
      await service.recordFleetEvent(request.auth!.tenantId, body);
      reply.status(201);
      return { ok: true };
    },
  );

  app.get(
    '/api/v1/fleet/events',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const query = request.query as FleetEventFilters;
      return { data: await service.listFleetEvents(request.auth!.tenantId, query) };
    },
  );

  app.post(
    '/api/v1/fleet/runtimes/:id/drain',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.drainRuntime(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );
};
