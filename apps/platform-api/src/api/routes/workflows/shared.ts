import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withAllowedScopes } from '../../../auth/fastify-auth-hook.js';
import {
  ConflictError,
  SchemaValidationFailedError,
  ValidationError,
} from '../../../errors/domain-errors.js';
import { ApprovalQueueService } from '../../../services/approval-queue-service.js';
import {
  EventQueryService,
  parseCursorAfter,
  parseCursorLimit,
} from '../../../services/event-query-service.js';
import { HandoffService } from '../../../services/handoff-service.js';
import { PlaybookWorkflowControlService } from '../../../services/playbook-workflow-control-service.js';
import { WorkflowActivationDispatchService } from '../../../services/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../../services/workflow-activation-service.js';
import { WorkflowChainingService } from '../../../services/workflow-chaining-service.js';
import { WorkflowDeliverableService } from '../../../services/workflow-deliverable-service.js';
import { WorkflowStateService } from '../../../services/workflow-state-service.js';
import { WorkflowToolResultService } from '../../../services/workflow-tool-result-service.js';
import type { DatabaseClient } from '../../../db/database.js';

const workflowBudgetSchema = z.object({
  token_budget: z.number().int().positive().optional(),
  cost_cap_usd: z.number().positive().optional(),
  max_duration_minutes: z.number().int().positive().optional(),
});

const requestIdSchema = z.string().min(1).max(255);

const workflowInitialInputPacketFileSchema = z.object({
  file_name: z.string().min(1).max(255),
  description: z.string().max(4000).optional(),
  content_base64: z.string().min(1),
  content_type: z.string().min(1).max(255).optional(),
});

const workflowInitialInputPacketSchema = z.object({
  summary: z.string().min(1).max(4000).optional(),
  structured_inputs: z.record(z.unknown()).optional(),
  files: z.array(workflowInitialInputPacketFileSchema).max(25).optional(),
});

export const workflowCreateSchema = z.object({
  request_id: requestIdSchema.optional(),
  playbook_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  operator_note: z.string().min(1).max(4000).optional(),
  initial_input_packet: workflowInitialInputPacketSchema.optional(),
  parameters: z.record(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  config_overrides: z.record(z.unknown()).optional(),
  instruction_config: z.record(z.unknown()).optional(),
  budget: workflowBudgetSchema.optional(),
  live_visibility_mode: z.enum(['standard', 'enhanced']).optional(),
});

export const workflowRedriveCreateSchema = z.object({
  request_id: requestIdSchema.optional(),
  name: z.string().min(1).max(255).optional(),
  reason: z.string().min(1).max(4000).optional(),
  summary: z.string().min(1).max(4000).optional(),
  steering_instruction: z.string().min(1).max(4000).optional(),
  redrive_input_packet_id: z.string().uuid().optional(),
  inheritance_policy: z.enum(['inherit_all', 'inherit_none']).optional(),
  parameters: z.record(z.string()).optional(),
  structured_inputs: z.record(z.unknown()).optional(),
  live_visibility_mode: z.enum(['standard', 'enhanced']).optional(),
  files: z.array(workflowInitialInputPacketFileSchema).max(25).optional(),
});

export const workflowSettingsPatchSchema = z.object({
  live_visibility_mode: z.enum(['standard', 'enhanced']).nullable(),
  settings_revision: z.number().int().min(0),
});

export const stageGateSchema = z.object({
  request_id: requestIdSchema,
  action: z.enum(['approve', 'reject', 'request_changes', 'block']),
  feedback: z.string().min(1).max(4000).optional(),
});

export const workflowChainSchema = z.object({
  request_id: requestIdSchema,
  playbook_id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  parameters: z.record(z.string()).optional(),
});

export const workflowControlMutationSchema = z.object({
  request_id: requestIdSchema,
});

export const workflowBulkDeleteSchema = z.object({
  workflow_ids: z.array(z.string().uuid()).min(1).max(10000),
});

export const workflowWorkItemTaskMutationSchema = z.object({
  request_id: requestIdSchema.optional(),
});

export const workflowWorkItemTaskRejectSchema = workflowWorkItemTaskMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
});

export const workflowWorkItemTaskRequestChangesSchema =
  workflowWorkItemTaskRejectSchema.extend({
    override_input: z.record(z.unknown()).optional(),
    preferred_agent_id: z.string().uuid().optional(),
    preferred_worker_id: z.string().uuid().optional(),
  });

export const workflowWorkItemTaskRetrySchema = workflowWorkItemTaskMutationSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

export const workflowWorkItemTaskSkipSchema = workflowWorkItemTaskMutationSchema.extend({
  reason: z.string().min(1).max(4000),
});

export const workflowWorkItemTaskReassignSchema = workflowWorkItemTaskSkipSchema.extend({
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

export const workflowWorkItemTaskResolveEscalationSchema =
  workflowWorkItemTaskMutationSchema.extend({
    instructions: z.string().min(1).max(4000),
    context: z.record(z.unknown()).optional(),
  });

export const workflowWorkItemTaskAgentEscalateSchema =
  workflowWorkItemTaskMutationSchema.extend({
    reason: z.string().min(1).max(4000),
    context_summary: z.string().max(4000).optional(),
    work_so_far: z.string().max(8000).optional(),
  });

export const workflowWorkItemTaskOutputOverrideSchema =
  workflowWorkItemTaskMutationSchema.extend({
    output: z.unknown(),
    reason: z.string().min(1).max(4000),
  });

export const workItemCreateSchema = z.object({
  request_id: requestIdSchema,
  parent_work_item_id: z.string().uuid().optional(),
  branch_key: z.string().min(1).max(120).optional(),
  stage_name: z.string().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(500),
  goal: z.string().max(4000).optional(),
  acceptance_criteria: z.string().max(4000).optional(),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).optional(),
  metadata: z.record(z.unknown()).optional(),
  initial_input_packet: workflowInitialInputPacketSchema.optional(),
});

export const workItemUpdateSchema = z.object({
  request_id: requestIdSchema,
  parent_work_item_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  goal: z.string().max(4000).optional(),
  acceptance_criteria: z.string().max(4000).optional(),
  stage_name: z.string().min(1).max(120).optional(),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).nullable().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const workItemResolveEscalationSchema = z.object({
  request_id: requestIdSchema,
  action: z.enum(['dismiss', 'unblock_subject', 'reopen_subject']),
  feedback: z.string().min(1).max(4000).optional(),
});

export const workflowDocumentCreateSchema = z.object({
  request_id: requestIdSchema,
  logical_name: z.string().min(1).max(255),
  source: z.enum(['repository', 'artifact', 'external']),
  title: z.string().max(4000).optional(),
  description: z.string().max(8000).optional(),
  metadata: z.record(z.unknown()).optional(),
  repository: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(4000).optional(),
  url: z.string().url().optional(),
  task_id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  logical_path: z.string().min(1).max(4000).optional(),
});

export const workflowDocumentUpdateSchema = z
  .object({
    request_id: requestIdSchema,
    source: z.enum(['repository', 'artifact', 'external']).optional(),
    title: z.string().max(4000).nullable().optional(),
    description: z.string().max(8000).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    repository: z.string().min(1).max(255).nullable().optional(),
    path: z.string().min(1).max(4000).nullable().optional(),
    url: z.string().url().nullable().optional(),
    task_id: z.string().uuid().nullable().optional(),
    artifact_id: z.string().uuid().nullable().optional(),
    logical_path: z.string().min(1).max(4000).nullable().optional(),
  })
  .refine(hasWorkflowDocumentUpdateFields, {
    message: 'At least one field is required',
  });

export const workflowDocumentDeleteQuerySchema = z.object({
  request_id: requestIdSchema,
});

export function createWorkflowRoutesContext(app: FastifyInstance) {
  const workflowService = app.workflowService;

  return {
    app,
    workflowService,
    workflowChainingService: new WorkflowChainingService(app.pgPool, workflowService),
    approvalQueueService: new ApprovalQueueService(app.pgPool),
    eventQueryService: new EventQueryService(app.pgPool),
    handoffService: new HandoffService(app.pgPool),
    toolResultService: new WorkflowToolResultService(app.pgPool),
    playbookControlService: new PlaybookWorkflowControlService({
      pool: app.pgPool,
      eventService: app.eventService,
      stateService: new WorkflowStateService(app.pgPool, app.eventService),
      activationService: new WorkflowActivationService(app.pgPool, app.eventService),
      activationDispatchService: new WorkflowActivationDispatchService({
        pool: app.pgPool,
        eventService: app.eventService,
        config: app.config,
      }),
      subjectTaskChangeService: app.taskService,
      workflowDeliverableService: new WorkflowDeliverableService(app.pgPool),
    }),
    workflowWorkItemTaskMutationPreHandler: [
      authenticateApiKey,
      withAllowedScopes(['admin', 'worker']),
    ],
  };
}

export type WorkflowRoutesContext = ReturnType<typeof createWorkflowRoutesContext>;

export function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export function parseCsv(raw?: string): string[] | undefined {
  return raw
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function assertTaskBelongsToWorkflowWorkItem(
  app: FastifyInstance,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  taskId: string,
) {
  const task = (await app.taskService.getTask(tenantId, taskId)) as Record<string, unknown>;
  if (task.workflow_id !== workflowId || task.work_item_id !== workItemId) {
    throw new ValidationError('Task must belong to the selected workflow work item');
  }
}

export async function assertTaskBelongsToWorkflowTask(
  app: FastifyInstance,
  tenantId: string,
  workflowId: string,
  taskId: string,
) {
  const task = (await app.taskService.getTask(tenantId, taskId)) as Record<string, unknown>;
  if (task.workflow_id !== workflowId) {
    throw new ValidationError('Task must belong to the selected workflow');
  }
  if (typeof task.work_item_id === 'string' && task.work_item_id.trim().length > 0) {
    throw new ValidationError(
      'Tasks attached to workflow work items must use the grouped work-item operator flow.',
    );
  }
}

export function selectWorkflowWorkItemRecoveryTask(tasks: Record<string, unknown>[]) {
  return (
    tasks.find((task) => readTaskState(task.state) === 'failed') ??
    tasks.find((task) => readTaskState(task.state) === 'escalated') ??
    null
  );
}

export function mapWorkflowCreateBody(body: z.infer<typeof workflowCreateSchema>) {
  return {
    ...body,
    initial_input_packet: body.initial_input_packet
      ? {
          summary: body.initial_input_packet.summary,
          structured_inputs: body.initial_input_packet.structured_inputs,
          files: mapWorkflowOperatorFiles(body.initial_input_packet.files),
        }
      : undefined,
  };
}

export function mapWorkItemCreateBody(body: z.infer<typeof workItemCreateSchema>) {
  return {
    ...body,
    initial_input_packet: body.initial_input_packet
      ? {
          summary: body.initial_input_packet.summary,
          structured_inputs: body.initial_input_packet.structured_inputs,
          files: mapWorkflowOperatorFiles(body.initial_input_packet.files),
        }
      : undefined,
  };
}

export function mapWorkflowOperatorFiles(
  files: Array<z.infer<typeof workflowInitialInputPacketFileSchema>> | undefined,
) {
  return files?.map((file) => ({
    fileName: file.file_name,
    description: file.description,
    contentBase64: file.content_base64,
    contentType: file.content_type,
  }));
}

export async function runIdempotentTransactionalWorkflowAction<T extends object>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    if (normalizedRequestId) {
      await toolResultService.lockRequest(
        tenantId,
        workflowId,
        toolName,
        normalizedRequestId,
        client,
      );
      const existing = await toolResultService.getResult(
        tenantId,
        workflowId,
        toolName,
        normalizedRequestId,
        client,
      );
      if (existing) {
        await client.query('COMMIT');
        return existing as T;
      }
    }

    const result = await run(client);
    if (normalizedRequestId) {
      const stored = await toolResultService.storeResult(
        tenantId,
        workflowId,
        toolName,
        normalizedRequestId,
        result as Record<string, unknown>,
        client,
      );
      await client.query('COMMIT');
      return stored as T;
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function runIdempotentWorkflowAction<T extends object>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId) {
    return run();
  }

  const existing = await loadStoredWorkflowActionResult(
    app,
    toolResultService,
    tenantId,
    workflowId,
    toolName,
    normalizedRequestId,
  );
  if (existing) {
    return existing as T;
  }

  const result = await run();
  const postMutationExisting = await loadStoredWorkflowActionResult(
    app,
    toolResultService,
    tenantId,
    workflowId,
    toolName,
    normalizedRequestId,
  );
  if (postMutationExisting) {
    return postMutationExisting as T;
  }

  return toolResultService.storeResult(
    tenantId,
    workflowId,
    toolName,
    normalizedRequestId,
    result as Record<string, unknown>,
  ) as Promise<T>;
}

function readTaskState(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

async function loadStoredWorkflowActionResult(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string,
) {
  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
    await toolResultService.lockRequest(tenantId, workflowId, toolName, requestId, client);
    const existing = await toolResultService.getResult(
      tenantId,
      workflowId,
      toolName,
      requestId,
      client,
    );
    await client.query('COMMIT');
    return existing;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function hasWorkflowDocumentUpdateFields(value: Record<string, unknown>) {
  return Object.keys(value).some((key) => key !== 'request_id');
}
