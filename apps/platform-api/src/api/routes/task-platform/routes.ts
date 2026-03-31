import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import path from 'node:path';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { applyArtifactPreviewHeaders } from '../../../bootstrap/plugins.js';
import { buildArtifactStorageConfig } from '../../../content/storage-config.js';
import { createArtifactStorage } from '../../../content/storage-factory.js';
import { SchemaValidationFailedError, ValidationError } from '../../../errors/domain-errors.js';
import {
  ArtifactCatalogService,
  parseArtifactCatalogArtifactId,
} from '../../../services/artifacts/artifact-catalog-service.js';
import { HandoffService } from '../../../services/handoff-service.js';
import { WorkflowDeliverableService } from '../../../services/workflow-deliverable-service.js';
import { WorkflowTaskDeliverablePromotionService } from '../../../services/workflow-task-deliverable-promotion-service.js';
import {
  completionCalloutsSchema,
  guidedClosureSuggestedActionSchema,
  guidedClosureWaivedStepSchema,
} from '../../../services/guided-closure/types.js';
import { assertWorkspaceMemoryWritesAreDurableKnowledge } from '../../../services/workspace/memory/workspace-memory-write-guard.js';
import { WorkspaceMemoryScopeService } from '../../../services/workspace/memory/workspace-memory-scope-service.js';
import { TaskAgentScopeService } from '../../../services/task-agent-scope-service.js';
import { WorkflowActivationDispatchService } from '../../../services/workflow-activation-dispatch-service.js';
import { WorkflowToolResultService } from '../../../services/workflow-tool-result-service.js';
import { registerTaskPlatformMemoryReadRoutes } from './memory-read-routes.js';
import { runIdempotentTaskRouteAction } from './route-idempotency.js';

const memoryUpdatesSchema = z
  .record(z.string().min(1).max(256), z.unknown())
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updates must contain at least one entry',
  });

const memoryPatchSchema = z.union([
  z.object({
    request_id: z.string().min(1).max(255).optional(),
    key: z.string().min(1).max(256),
    value: z.unknown(),
  }),
  z.object({
    request_id: z.string().min(1).max(255).optional(),
    updates: memoryUpdatesSchema,
  }),
]);

const taskHandoffSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    task_rework_count: z.number().int().min(0).optional(),
    summary: z.string().min(1).max(4000),
    completion: z.enum(['full', 'blocked']).optional(),
    completion_state: z.enum(['full', 'blocked']).optional(),
    resolution: z.enum(['approved', 'request_changes', 'rejected', 'blocked']).optional(),
    decision_state: z.enum(['approved', 'request_changes', 'rejected', 'blocked']).optional(),
    closure_effect: z.enum(['blocking', 'advisory']).optional(),
    changes: z.array(z.unknown()).max(200).optional(),
    decisions: z.array(z.unknown()).max(200).optional(),
    remaining_items: z.array(z.unknown()).max(200).optional(),
    blockers: z.array(z.unknown()).max(200).optional(),
    focus_areas: z.array(z.string().min(1).max(4000)).max(100).optional(),
    known_risks: z.array(z.string().min(1).max(4000)).max(100).optional(),
    recommended_next_actions: z.array(guidedClosureSuggestedActionSchema).max(100).optional(),
    waived_steps: z.array(guidedClosureWaivedStepSchema).max(100).optional(),
    completion_callouts: completionCalloutsSchema.optional(),
    successor_context: z.string().max(8000).optional(),
    role_data: z.record(z.unknown()).optional(),
    subject_ref: z.record(z.unknown()).optional(),
    subject_revision: z.number().int().positive().optional(),
    outcome_action_applied: z
      .enum(['reopen_subject', 'route_to_role', 'block_subject', 'escalate', 'terminate_branch'])
      .optional(),
    branch_id: z.string().uuid().optional(),
    artifact_ids: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.completion && !value.completion_state) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'completion or completion_state is required',
        path: ['completion_state'],
      });
    }
  });

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const taskPlatformRoutes: FastifyPluginAsync = async (app) => {
  const taskScopeService = new TaskAgentScopeService(app.pgPool);
  const toolResultService = new WorkflowToolResultService(app.pgPool);
  const activationDispatchService = new WorkflowActivationDispatchService({
    pool: app.pgPool,
    eventService: app.eventService,
    config: app.config,
  });
  const workflowDeliverableService = new WorkflowDeliverableService(app.pgPool);
  const workflowTaskDeliverablePromotionService = new WorkflowTaskDeliverablePromotionService(
    app.pgPool,
    workflowDeliverableService,
  );
  const handoffService = new HandoffService(
    app.pgPool,
    app.logService,
    app.eventService,
    activationDispatchService,
    workflowTaskDeliverablePromotionService,
  );
  const workspaceMemoryScopeService = new WorkspaceMemoryScopeService(app.pgPool);
  const artifactCatalogService = new ArtifactCatalogService(
    app.pgPool,
    createArtifactStorage(buildArtifactStorageConfig(app.config)),
    app.config.ARTIFACT_ACCESS_URL_TTL_SECONDS,
    app.config.ARTIFACT_PREVIEW_MAX_BYTES,
  );

  registerTaskPlatformMemoryReadRoutes(app, { taskScopeService, workspaceMemoryScopeService });

  app.post(
    '/api/v1/tasks/:id/handoff',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(taskHandoffSchema.safeParse(request.body));
      await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      const data = await handoffService.submitTaskHandoff(
        request.auth!.tenantId,
        params.id,
        body,
      );
      return { data };
    },
  );

  app.get(
    '/api/v1/tasks/:id/predecessor-handoff',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      const data = await handoffService.getPredecessorHandoff(
        request.auth!.tenantId,
        params.id,
      );
      return { data };
    },
  );

  app.patch(
    '/api/v1/tasks/:id/memory',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(memoryPatchSchema.safeParse(request.body));
      const task = await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      if (!task.workspace_id) {
        throw new ValidationError('Task is not linked to a workspace');
      }
      const memoryEntries =
        'updates' in body
          ? Object.entries(body.updates).map(([key, value]) => ({ key, value }))
          : [{ key: body.key, value: body.value }];
      assertWorkspaceMemoryWritesAreDurableKnowledge(memoryEntries);
      const workspaceId = task.workspace_id;
      const context = {
        workflow_id: task.workflow_id,
        work_item_id: task.work_item_id,
        task_id: task.id,
        stage_name: task.stage_name,
      };
      const requestId = body.request_id;
      const data = await runIdempotentTaskRouteAction(
        app,
        toolResultService,
        async () => task,
        request.auth!.tenantId,
        params.id,
        'task_memory_patch',
        requestId,
        async () => {
          if ('updates' in body) {
            return app.workspaceService.patchWorkspaceMemoryEntries(
              request.auth!,
              workspaceId,
              Object.entries(body.updates).map(([key, value]) => ({
                key,
                value,
                context,
              })),
            );
          }

          return app.workspaceService.patchWorkspaceMemory(request.auth!, workspaceId, {
            key: body.key,
            value: body.value,
            context,
          });
        },
      );
      return { data };
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifact-catalog',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as {
        task_id?: string;
        work_item_id?: string;
        name_prefix?: string;
        limit?: string;
      };
      await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      if (query.limit !== undefined && !Number.isFinite(limit)) {
        throw new ValidationError('limit must be a valid number');
      }
      return {
        data: await artifactCatalogService.listArtifactsForTaskScope(
          request.auth!.tenantId,
          params.id,
          {
            task_id: query.task_id,
            work_item_id: query.work_item_id,
            name_prefix: query.name_prefix,
            limit,
          },
        ),
      };
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifact-catalog/:artifactId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
      const artifactId = parseArtifactCatalogArtifactId(params.artifactId);
      const result = await artifactCatalogService.downloadArtifactForTaskScope(
        request.auth!.tenantId,
        params.id,
        artifactId,
      );
      reply.header('Content-Type', result.contentType);
      reply.header(
        'Content-Disposition',
        `attachment; filename="${escapeArtifactDownloadFileName(resolveArtifactFileName(result.artifact.logical_path, params.artifactId))}"`,
      );
      return reply.send(result.data);
    },
  );

  async function sendCatalogPreviewResponse(
    request: FastifyRequest,
    reply: FastifyReply,
    params: { id: string; artifactId: string },
  ): Promise<FastifyReply> {
    await taskScopeService.loadAgentOwnedActiveTask(request.auth!, params.id);
    const artifactId = parseArtifactCatalogArtifactId(params.artifactId);
    const result = await artifactCatalogService.previewArtifactForTaskScope(
      request.auth!.tenantId,
      params.id,
      artifactId,
    );
    applyArtifactPreviewHeaders(reply, result.fileName, result.contentType);
    return reply.send(result.data);
  }

  app.get(
    '/api/v1/tasks/:id/artifact-catalog/:artifactId/preview',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      return sendCatalogPreviewResponse(request, reply, params);
    },
  );

  app.get(
    '/api/v1/tasks/:id/artifact-catalog/:artifactId/permalink',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; artifactId: string };
      return sendCatalogPreviewResponse(request, reply, params);
    },
  );
};

function resolveArtifactFileName(logicalPath: string | null | undefined, fallback: string): string {
  const fileName = path.posix.basename(logicalPath ?? '');
  if (fileName.length > 0 && fileName !== '.') {
    return fileName;
  }
  return fallback;
}

function escapeArtifactDownloadFileName(fileName: string): string {
  return fileName.replace(/["\\\r\n]/g, '_');
}
