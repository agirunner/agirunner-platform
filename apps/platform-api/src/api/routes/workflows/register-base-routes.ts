import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../../pagination.js';
import { ValidationError } from '../../../errors/domain-errors.js';
import { parseCursorAfter, parseCursorLimit } from '../../../services/event-query-service.js';
import {
  mapWorkflowCreateBody,
  mapWorkflowOperatorFiles,
  parseCsv,
  parseOrThrow,
  workflowCreateSchema,
  workflowRedriveCreateSchema,
  workflowSettingsPatchSchema,
  type WorkflowRoutesContext,
} from './shared.js';

export function registerWorkflowBaseRoutes(context: WorkflowRoutesContext) {
  const { app, workflowService, eventQueryService, approvalQueueService } = context;

  app.post(
    '/api/v1/workflows',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      if (
        request.body
        && typeof request.body === 'object'
        && !Array.isArray(request.body)
        && Object.hasOwn(request.body as Record<string, unknown>, 'model_overrides')
      ) {
        throw new ValidationError('model_overrides is no longer supported');
      }
      const body = parseOrThrow(workflowCreateSchema.safeParse(request.body));
      const workflow = await workflowService.createWorkflow(request.auth!, {
        ...mapWorkflowCreateBody(body),
        metadata: body.metadata,
        live_visibility_mode: body.live_visibility_mode,
      });
      return reply.status(201).send({ data: workflow });
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
        reason: body.reason,
        summary: body.summary,
        steeringInstruction: body.steering_instruction,
        redriveInputPacketId: body.redrive_input_packet_id,
        inheritancePolicy: body.inheritance_policy,
        parameters: body.parameters,
        structuredInputs: body.structured_inputs,
        liveVisibilityMode: body.live_visibility_mode,
        files: mapWorkflowOperatorFiles(body.files),
      });
      return reply.status(201).send({ data: redrive });
    },
  );

  app.get(
    '/api/v1/workflows/:id/settings',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.workflowSettingsService.getWorkflowSettings(request.auth!.tenantId, params.id),
      };
    },
  );

  app.patch(
    '/api/v1/workflows/:id/settings',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(workflowSettingsPatchSchema.safeParse(request.body ?? {}));
      return {
        data: await app.workflowSettingsService.updateWorkflowSettings(request.auth!, params.id, {
          liveVisibilityMode: body.live_visibility_mode,
          settingsRevision: body.settings_revision,
        }),
      };
    },
  );

  app.get(
    '/api/v1/workflows',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const page = Number(query.page ?? DEFAULT_PAGE);
      const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);
      if (
        !Number.isFinite(page) ||
        page <= 0 ||
        !Number.isFinite(perPage) ||
        perPage <= 0 ||
        perPage > MAX_PER_PAGE
      ) {
        throw new ValidationError('Invalid pagination values');
      }

      return workflowService.listWorkflows(request.auth!.tenantId, {
        workspace_id: query.workspace_id,
        state: query.state,
        playbook_id: query.playbook_id,
        page,
        per_page: perPage,
      });
    },
  );

  app.get(
    '/api/v1/workflows/:id',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const workflow = await workflowService.getWorkflow(request.auth!.tenantId, params.id);
      return { data: workflow };
    },
  );

  app.get(
    '/api/v1/workflows/:id/budget',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await workflowService.getWorkflowBudget(request.auth!.tenantId, params.id),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/board',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await workflowService.getWorkflowBoard(request.auth!.tenantId, params.id) };
    },
  );

  app.get(
    '/api/v1/workflows/:id/stages',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await workflowService.listWorkflowStages(request.auth!.tenantId, params.id) };
    },
  );

  app.get(
    '/api/v1/workflows/:id/events',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      const query = request.query as {
        types?: string;
        event_type?: string;
        entity_type?: string;
        entity_id?: string;
        work_item_id?: string;
        stage_name?: string;
        activation_id?: string;
        gate_id?: string;
        after?: string;
        limit?: string;
        per_page?: string;
      };
      return eventQueryService.listEvents({
        tenantId: request.auth!.tenantId,
        workflowScopeId: params.id,
        entityTypes: parseCsv(query.entity_type),
        entityId: query.entity_id,
        workItemId: query.work_item_id,
        stageName: query.stage_name,
        activationId: query.activation_id,
        gateId: query.gate_id,
        eventTypes: parseCsv(query.types ?? query.event_type),
        after: parseCursorAfter(query.after),
        limit: parseCursorLimit(query.limit ?? query.per_page),
      });
    },
  );

  app.get(
    '/api/v1/workflows/:id/gates',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await approvalQueueService.listWorkflowGates(request.auth!.tenantId, params.id),
      };
    },
  );

  app.get(
    '/api/v1/workflows/:id/gates/:gateId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { id: string; gateId: string };
      return {
        data: await approvalQueueService.getGate(request.auth!.tenantId, params.gateId, params.id),
      };
    },
  );
}
