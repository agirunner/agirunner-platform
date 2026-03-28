import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes, withScope } from '../../auth/fastify-auth-hook.js';
import { applyArtifactPreviewHeaders } from '../../bootstrap/plugins.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const workflowOperatorFileUploadSchema = z.object({
  description: z.string().max(2000).optional(),
  file_name: z.string().min(1).max(255),
  content_base64: z.string().min(1),
  content_type: z.string().min(1).max(255).optional(),
});

const workflowInputPacketCreateSchema = z.object({
  packet_kind: z.string().min(1).max(120),
  source: z.string().min(1).max(120).optional(),
  summary: z.string().max(4000).optional(),
  structured_inputs: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  work_item_id: z.string().uuid().optional(),
  files: z.array(workflowOperatorFileUploadSchema).default([]),
});

const workflowInterventionCreateSchema = z.object({
  kind: z.string().min(1).max(120),
  origin: z.string().min(1).max(120).optional(),
  status: z.string().min(1).max(120).optional(),
  summary: z.string().min(1).max(4000),
  note: z.string().max(4000).optional(),
  structured_action: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  work_item_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  files: z.array(workflowOperatorFileUploadSchema).default([]),
});

const workflowOperatorBriefCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  execution_context_id: z.string().min(1).max(255),
  workflow_id: z.string().min(1).max(255).optional(),
  work_item_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  brief_kind: z.string().min(1).max(120),
  brief_scope: z.string().min(1).max(120),
  source_kind: z.string().min(1).max(120),
  source_role_name: z.string().max(255).optional(),
  status_kind: z.string().min(1).max(120).optional(),
  payload: z.object({
    short_brief: z.record(z.unknown()),
    detailed_brief_json: z.record(z.unknown()),
    linked_target_ids: z.array(z.string().min(1).max(255)).optional(),
    linked_deliverables: z.array(z.object({
      descriptor_kind: z.string().min(1).max(120),
      delivery_stage: z.string().min(1).max(120),
      title: z.string().min(1).max(255),
      state: z.string().min(1).max(120),
      summary_brief: z.string().max(4000).optional(),
      work_item_id: z.string().uuid().optional(),
      preview_capabilities: z.record(z.unknown()).optional(),
      primary_target: z.record(z.unknown()),
      secondary_targets: z.array(z.record(z.unknown())).optional(),
      content_preview: z.record(z.unknown()).optional(),
    })).default([]),
  }),
  related_artifact_ids: z.array(z.string().min(1).max(255)).optional(),
  related_intervention_ids: z.array(z.string().min(1).max(255)).optional(),
  canonical_workflow_brief_id: z.string().uuid().optional(),
});

const workflowOperatorUpdateCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  execution_context_id: z.string().min(1).max(255),
  workflow_id: z.string().min(1).max(255).optional(),
  work_item_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  source_kind: z.string().min(1).max(120),
  source_role_name: z.string().max(255).optional(),
  payload: z.object({
    update_kind: z.string().min(1).max(120),
    headline: z.string().min(1).max(4000),
    summary: z.string().max(4000).optional(),
    linked_target_ids: z.array(z.string().min(1).max(255)).optional(),
    promoted_brief_id: z.string().uuid().optional(),
  }),
});

const workflowSteeringRequestCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  base_snapshot_version: z.string().min(1).max(255).optional(),
  request: z.string().min(1).max(8000),
  work_item_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  linked_input_packet_ids: z.array(z.string().uuid()).default([]),
  session_id: z.string().uuid().optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const workflowOperatorRecordRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/workflows/:id/operator-briefs',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { work_item_id?: string; limit?: string };
      return {
        data: await app.workflowOperatorBriefService.listBriefs(request.auth!.tenantId, params.id, {
          workItemId: query.work_item_id,
          limit: query.limit ? Number(query.limit) : undefined,
        }),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/operator-briefs',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker', 'agent'])] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowOperatorBriefCreateSchema.safeParse(request.body ?? {}));
      assertBodyWorkflowId(params.id, body.workflow_id);
      const brief = await app.workflowOperatorBriefService.recordBriefWrite(request.auth!, params.id, {
        requestId: body.request_id,
        executionContextId: body.execution_context_id,
        workItemId: body.work_item_id,
        taskId: body.task_id,
        briefKind: body.brief_kind,
        briefScope: body.brief_scope,
        sourceKind: body.source_kind,
        sourceRoleName: body.source_role_name,
        statusKind: body.status_kind,
        payload: {
          shortBrief: body.payload.short_brief,
          detailedBriefJson: body.payload.detailed_brief_json,
          linkedDeliverables: body.payload.linked_deliverables.map((entry) => ({
            descriptorKind: entry.descriptor_kind,
            deliveryStage: entry.delivery_stage,
            title: entry.title,
            state: entry.state,
            summaryBrief: entry.summary_brief,
            workItemId: entry.work_item_id,
            previewCapabilities: entry.preview_capabilities,
            primaryTarget: entry.primary_target,
            secondaryTargets: entry.secondary_targets,
            contentPreview: entry.content_preview,
          })),
          linkedTargetIds: body.payload.linked_target_ids,
        },
        relatedArtifactIds: body.related_artifact_ids,
        relatedInterventionIds: body.related_intervention_ids,
        canonicalWorkflowBriefId: body.canonical_workflow_brief_id,
      });
      return reply.status(201).send({ data: brief });
    },
  );

  app.get(
    '/api/v1/workflows/:id/operator-updates',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as { work_item_id?: string; limit?: string };
      return {
        data: await app.workflowOperatorUpdateService.listUpdates(request.auth!.tenantId, params.id, {
          workItemId: query.work_item_id,
          limit: query.limit ? Number(query.limit) : undefined,
        }),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/operator-updates',
    { preHandler: [authenticateApiKey, withAllowedScopes(['admin', 'worker', 'agent'])] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowOperatorUpdateCreateSchema.safeParse(request.body ?? {}));
      assertBodyWorkflowId(params.id, body.workflow_id);
      const update = await app.workflowOperatorUpdateService.recordUpdateWrite(request.auth!, params.id, {
        requestId: body.request_id,
        executionContextId: body.execution_context_id,
        workItemId: body.work_item_id,
        taskId: body.task_id,
        sourceKind: body.source_kind,
        sourceRoleName: body.source_role_name,
        payload: {
          updateKind: body.payload.update_kind,
          headline: body.payload.headline,
          summary: body.payload.summary,
          linkedTargetIds: body.payload.linked_target_ids,
          promotedBriefId: body.payload.promoted_brief_id,
        },
      });
      return reply.status(201).send({ data: update });
    },
  );

  app.get(
    '/api/v1/workflows/:id/input-packets',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.workflowInputPacketService.listWorkflowInputPackets(request.auth!.tenantId, params.id),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/input-packets',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowInputPacketCreateSchema.safeParse(request.body ?? {}));
      const packet = await app.workflowInputPacketService.createWorkflowInputPacket(request.auth!, params.id, {
        packetKind: body.packet_kind,
        source: body.source,
        summary: body.summary,
        structuredInputs: body.structured_inputs,
        metadata: body.metadata,
        workItemId: body.work_item_id,
        files: body.files.map((entry) => ({
          fileName: entry.file_name,
          description: entry.description,
          contentBase64: entry.content_base64,
          contentType: entry.content_type,
        })),
      });
      return reply.status(201).send({ data: packet });
    },
  );

  app.get(
    '/api/v1/workflows/:id/input-packets/:packetId/files/:fileId/content',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; packetId: string; fileId: string };
      const result = await app.workflowInputPacketService.downloadWorkflowInputPacketFile(
        request.auth!.tenantId,
        params.id,
        params.packetId,
        params.fileId,
      );
      applyArtifactPreviewHeaders(reply, result.file.file_name, result.contentType);
      return reply.send(result.data);
    },
  );

  app.get(
    '/api/v1/workflows/:id/interventions',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.workflowInterventionService.listWorkflowInterventions(request.auth!.tenantId, params.id),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/interventions',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowInterventionCreateSchema.safeParse(request.body ?? {}));
      const intervention = await app.workflowInterventionService.recordIntervention(request.auth!, params.id, {
        kind: body.kind,
        origin: body.origin,
        status: body.status,
        summary: body.summary,
        note: body.note,
        structuredAction: body.structured_action,
        metadata: body.metadata,
        workItemId: body.work_item_id,
        taskId: body.task_id,
        files: body.files.map((entry) => ({
          fileName: entry.file_name,
          description: entry.description,
          contentBase64: entry.content_base64,
          contentType: entry.content_type,
        })),
      });
      return reply.status(201).send({ data: intervention });
    },
  );

  app.get(
    '/api/v1/workflows/:id/interventions/:interventionId/files/:fileId/content',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { id: string; interventionId: string; fileId: string };
      const result = await app.workflowInterventionService.downloadWorkflowInterventionFile(
        request.auth!.tenantId,
        params.id,
        params.interventionId,
        params.fileId,
      );
      applyArtifactPreviewHeaders(reply, result.file.file_name, result.contentType);
      return reply.send(result.data);
    },
  );

  app.get(
    '/api/v1/workflows/:id/steering-sessions',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.workflowSteeringSessionService.listSessions(request.auth!.tenantId, params.id),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/steering-sessions/:sessionId/messages',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; sessionId: string };
      return {
        data: await app.workflowSteeringSessionService.listMessages(
          request.auth!.tenantId,
          params.id,
          params.sessionId,
        ),
      };
    },
  );

  app.post(
    '/api/v1/workflows/:id/steering-requests',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowSteeringRequestCreateSchema.safeParse(request.body ?? {}));
      const result = await app.workflowSteeringSessionService.recordSteeringRequest(request.auth!, params.id, {
        requestId: body.request_id,
        baseSnapshotVersion: body.base_snapshot_version,
        request: body.request,
        workItemId: body.work_item_id,
        taskId: body.task_id,
        linkedInputPacketIds: body.linked_input_packet_ids,
        sessionId: body.session_id,
      });
      return reply.status(201).send({ data: result });
    },
  );
};

function assertBodyWorkflowId(pathWorkflowId: string, bodyWorkflowId?: string): void {
  if (bodyWorkflowId && bodyWorkflowId !== pathWorkflowId) {
    throw new SchemaValidationFailedError('Workflow id in body must match the route workflow id');
  }
}
