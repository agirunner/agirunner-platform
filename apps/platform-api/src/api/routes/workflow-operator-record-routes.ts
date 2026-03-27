import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
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
  work_item_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  brief_kind: z.string().min(1).max(120),
  brief_scope: z.string().min(1).max(120),
  source_kind: z.string().min(1).max(120),
  source_role_name: z.string().max(255).optional(),
  status_kind: z.string().min(1).max(120),
  short_brief: z.record(z.unknown()),
  detailed_brief_json: z.record(z.unknown()),
  related_artifact_ids: z.array(z.string().min(1).max(255)).optional(),
  related_output_descriptor_ids: z.array(z.string().min(1).max(255)).optional(),
  related_intervention_ids: z.array(z.string().min(1).max(255)).optional(),
  canonical_workflow_brief_id: z.string().uuid().optional(),
});

const workflowOperatorUpdateCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  execution_context_id: z.string().min(1).max(255),
  work_item_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  source_kind: z.string().min(1).max(120),
  source_role_name: z.string().max(255).optional(),
  update_kind: z.string().min(1).max(120),
  headline: z.string().min(1).max(4000),
  summary: z.string().max(4000).optional(),
  linked_target_ids: z.array(z.string().min(1).max(255)).optional(),
  visibility_mode: z.enum(['standard', 'enhanced']),
  promoted_brief_id: z.string().uuid().optional(),
});

const workflowSteeringSessionCreateSchema = z.object({
  title: z.string().max(255).optional(),
});

const workflowSteeringMessageCreateSchema = z.object({
  content: z.string().min(1).max(8000),
  structured_proposal: z.record(z.unknown()).optional(),
  intervention_id: z.string().uuid().optional(),
});

const workflowRedriveCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  name: z.string().min(1).max(255).optional(),
  summary: z.string().max(4000).optional(),
  steering_instruction: z.string().max(4000).optional(),
  parameters: z.record(z.string()).optional(),
  structured_inputs: z.record(z.unknown()).optional(),
  live_visibility_mode: z.enum(['standard', 'enhanced']).optional(),
  files: z.array(workflowOperatorFileUploadSchema).default([]),
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
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowOperatorBriefCreateSchema.safeParse(request.body ?? {}));
      const brief = await app.workflowOperatorBriefService.recordBrief(request.auth!, params.id, {
        requestId: body.request_id,
        executionContextId: body.execution_context_id,
        workItemId: body.work_item_id,
        taskId: body.task_id,
        briefKind: body.brief_kind,
        briefScope: body.brief_scope,
        sourceKind: body.source_kind,
        sourceRoleName: body.source_role_name,
        statusKind: body.status_kind,
        shortBrief: body.short_brief,
        detailedBriefJson: body.detailed_brief_json,
        relatedArtifactIds: body.related_artifact_ids,
        relatedOutputDescriptorIds: body.related_output_descriptor_ids,
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
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowOperatorUpdateCreateSchema.safeParse(request.body ?? {}));
      const update = await app.workflowOperatorUpdateService.recordUpdate(request.auth!, params.id, {
        requestId: body.request_id,
        executionContextId: body.execution_context_id,
        workItemId: body.work_item_id,
        taskId: body.task_id,
        sourceKind: body.source_kind,
        sourceRoleName: body.source_role_name,
        updateKind: body.update_kind,
        headline: body.headline,
        summary: body.summary,
        linkedTargetIds: body.linked_target_ids,
        visibilityMode: body.visibility_mode,
        promotedBriefId: body.promoted_brief_id,
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

  app.post(
    '/api/v1/workflows/:id/steering-sessions',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowSteeringSessionCreateSchema.safeParse(request.body ?? {}));
      const session = await app.workflowSteeringSessionService.createSession(request.auth!, params.id, {
        title: body.title,
      });
      return reply.status(201).send({ data: session });
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
    '/api/v1/workflows/:id/steering-sessions/:sessionId/messages',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string; sessionId: string };
      const body = parseOrThrow(workflowSteeringMessageCreateSchema.safeParse(request.body ?? {}));
      const message = await app.workflowSteeringSessionService.appendMessage(
        request.auth!,
        params.id,
        params.sessionId,
        {
          role: 'operator',
          content: body.content,
          structuredProposal: body.structured_proposal,
          interventionId: body.intervention_id,
        },
      );
      return reply.status(201).send({ data: message });
    },
  );

  app.post(
    '/api/v1/workflows/:id/redrives',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowRedriveCreateSchema.safeParse(request.body ?? {}));
      const redrive = await app.workflowRedriveService.redriveWorkflow(request.auth!, params.id, {
        requestId: body.request_id,
        name: body.name,
        summary: body.summary,
        steeringInstruction: body.steering_instruction,
        parameters: body.parameters,
        structuredInputs: body.structured_inputs,
        liveVisibilityMode: body.live_visibility_mode,
        files: body.files.map((entry) => ({
          fileName: entry.file_name,
          description: entry.description,
          contentBase64: entry.content_base64,
          contentType: entry.content_type,
        })),
      });
      return reply.status(201).send({ data: redrive });
    },
  );
};
