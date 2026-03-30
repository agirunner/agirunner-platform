import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiKeyIdentity } from '../../auth/api-key.js';
import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import type { DatabaseQueryable } from '../../db/database.js';
import { WorkflowActivationDispatchService } from '../../services/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../services/workflow-activation-service.js';
import { WorkflowDeliverableService } from '../../services/workflow-deliverable-service.js';
import { WorkflowStateService } from '../../services/workflow-state-service.js';
import { PlaybookWorkflowControlService } from '../../services/playbook-workflow-control-service.js';
import { OrchestratorTaskMessageService } from '../../services/orchestrator-task-message-service.js';
import { OrchestratorActivationCheckpointService } from '../../services/orchestrator-activation-checkpoint-service.js';
import { WorkItemContinuityService } from '../../services/work-item-continuity-service.js';
import { assertWorkspaceMemoryWritesAreDurableKnowledge } from '../../services/workspace-memory-write-guard.js';
import {
  TaskAgentScopeService,
  type ActiveOrchestratorTaskScope,
} from '../../services/task-agent-scope-service.js';
import { HandoffService } from '../../services/handoff-service.js';
import {
  ConflictError,
  NotFoundError,
  SchemaValidationFailedError,
  ValidationError,
} from '../../errors/domain-errors.js';
import { readWorkerDispatchAckTimeoutMs } from '../../services/platform-timing-defaults.js';
import { WorkflowToolResultService } from '../../services/workflow-tool-result-service.js';
import { ArtifactService } from '../../services/artifact-service.js';
import {
  buildAssessmentSubjectInput,
  buildAssessmentSubjectMetadata,
  hasExplicitAssessmentSubjectLinkage,
  mergeAssessmentSubjectLinkage,
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from '../../services/assessment-subject-service.js';
import {
  PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
  mustGetSafetynetEntry,
} from '../../services/safetynet/registry.js';
import { logSafetynetTriggered } from '../../services/safetynet/logging.js';
import { buildArtifactStorageConfig } from '../../content/storage-config.js';
import { createArtifactStorage } from '../../content/storage-factory.js';
import {
  completionCalloutsSchema,
  buildRecoverableMutationResult,
  guidedClosureUnresolvedAdvisoryItemSchema,
  guidedClosureWaivedStepSchema,
  type GuidedClosureStateSnapshot,
} from '../../services/guided-closure/types.js';
import { GuidedClosureRecoveryHelpersService } from '../../services/guided-closure/recovery-helpers.js';

const orchestratorTaskTypeSchema = z.enum(['analysis', 'code', 'assessment', 'test', 'docs', 'custom']);
const credentialRefsSchema = z.record(z.string().min(1).max(255)).refine(
  (record) => Object.values(record).every((value) => value.trim().startsWith('secret:')),
  { message: 'credentials must use secret: references' },
);

const workItemCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  parent_work_item_id: z.string().uuid().optional(),
  stage_name: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  goal: z.string().min(1).max(4000),
  acceptance_criteria: z.string().min(1).max(4000),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const workItemUpdateSchema = z.object({
  request_id: z.string().min(1).max(255),
  parent_work_item_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  goal: z.string().max(4000).optional(),
  acceptance_criteria: z.string().max(4000).optional(),
  stage_name: z.string().min(1).max(120).optional(),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).nullable().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const workItemCompleteSchema = z.object({
  request_id: z.string().min(1).max(255),
  completion_callouts: completionCalloutsSchema.optional(),
  waived_steps: z.array(guidedClosureWaivedStepSchema).max(100).optional(),
  unresolved_advisory_items: z.array(guidedClosureUnresolvedAdvisoryItemSchema).max(100).optional(),
  completion_notes: z.string().min(1).max(4000).nullable().optional(),
}).strict();

const orchestratorTaskCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  work_item_id: z.string().uuid(),
  stage_name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  subject_task_id: z.string().uuid().optional(),
  subject_work_item_id: z.string().uuid().optional(),
  subject_handoff_id: z.string().uuid().optional(),
  subject_revision: z.number().int().positive().optional(),
  type: orchestratorTaskTypeSchema.optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  input: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  depends_on: z.array(z.string().uuid()).optional(),
  credentials: credentialRefsSchema.optional(),
  assessment_prompt: z.string().max(2000).optional(),
  role_config: z.record(z.unknown()).optional(),
  environment: z.record(z.unknown()).optional(),
  resource_bindings: z.array(z.unknown()).optional(),
  timeout_minutes: z.number().int().min(1).max(240).optional(),
  token_budget: z.number().int().positive().optional(),
  cost_cap_usd: z.number().positive().optional(),
  auto_retry: z.boolean().optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  max_iterations: z.number().int().min(1).optional(),
  llm_max_retries: z.number().int().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const orchestratorTaskInputUpdateSchema = z.object({
  request_id: z.string().min(1).max(255),
  input: z.record(z.unknown()),
});

const orchestratorTaskMutationSchema = z.object({
  request_id: z.string().min(1).max(255),
});

const orchestratorTaskRetrySchema = orchestratorTaskMutationSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

const rerunTaskWithCorrectedBriefSchema = z.object({
  request_id: z.string().min(1).max(255),
  corrected_input: z.record(z.unknown()),
}).strict();

const orchestratorTaskReworkSchema = orchestratorTaskMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
  override_input: z.record(z.unknown()).optional(),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

const orchestratorTaskReassignSchema = orchestratorTaskMutationSchema.extend({
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(4000),
});

const reattachOrReplaceStaleOwnerSchema = z.object({
  request_id: z.string().min(1).max(255),
  reason: z.string().min(1).max(4000),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
}).strict();

const orchestratorTaskEscalateSchema = orchestratorTaskMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
  recommendation: z.string().max(4000).optional(),
  blocking_task_id: z.string().uuid().optional(),
  urgency: z.enum(['info', 'important', 'critical']).optional(),
});

const orchestratorTaskMessageSchema = orchestratorTaskMutationSchema.extend({
  message: z.string().min(1).max(4000),
  urgency: z.enum(['info', 'important', 'critical']).optional(),
});

const gateRequestSchema = z.object({
  request_id: z.string().min(1).max(255),
  summary: z.string().min(1).max(4000),
  recommendation: z.string().max(4000).optional(),
  key_artifacts: z.array(z.record(z.unknown())).max(50).optional(),
  concerns: z.array(z.string().min(1).max(4000)).max(50).optional(),
});

const stageAdvanceSchema = z.object({
  request_id: z.string().min(1).max(255),
  to_stage_name: z.string().min(1).max(120).optional(),
  summary: z.string().max(4000).optional(),
});

const workflowCompleteSchema = z.object({
  request_id: z.string().min(1).max(255),
  summary: z.string().min(1).max(4000),
  final_artifacts: z.array(z.string().min(1).max(2000)).max(100).optional(),
  completion_callouts: completionCalloutsSchema.optional(),
  waived_steps: z.array(guidedClosureWaivedStepSchema).max(100).optional(),
  unresolved_advisory_items: z.array(guidedClosureUnresolvedAdvisoryItemSchema).max(100).optional(),
  completion_notes: z.string().min(1).max(4000).nullable().optional(),
}).strict();

const reopenWorkItemForMissingHandoffSchema = z.object({
  request_id: z.string().min(1).max(255),
  reason: z.string().min(1).max(4000),
}).strict();

const waivePreferredStepSchema = z.object({
  request_id: z.string().min(1).max(255),
  code: z.string().min(1).max(255),
  reason: z.string().min(1).max(4000),
  summary: z.string().min(1).max(4000).optional(),
  role: z.string().min(1).max(120).optional(),
}).strict();

const workspaceMemoryUpdatesSchema = z
  .record(z.string().min(1).max(256), z.unknown())
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updates must contain at least one entry',
  });

const workspaceMemoryWriteSchema = z.union([
  z.object({
    request_id: z.string().min(1).max(255),
    key: z.string().min(1).max(256),
    value: z.unknown(),
    work_item_id: z.string().uuid().optional(),
  }),
  z.object({
    request_id: z.string().min(1).max(255),
    updates: workspaceMemoryUpdatesSchema,
    work_item_id: z.string().uuid().optional(),
  }),
]);

const childWorkflowCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  playbook_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  parent_context: z.string().max(8000).optional(),
  parameters: z.record(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  config_overrides: z.record(z.unknown()).optional(),
  instruction_config: z.record(z.unknown()).optional(),
});

const orchestratorActivationCheckpointSchema = z.object({
  request_id: z.string().min(1).max(255),
  activation_checkpoint: z.object({
    activation_id: z.string().min(1).max(255).optional(),
    trigger: z.string().min(1).max(255).optional(),
    what_changed: z.array(z.string().min(1).max(4000)).max(100).optional(),
    current_working_state: z.string().min(1).max(4000).optional(),
    next_expected_event: z.string().min(1).max(255).optional(),
    important_ids: z.array(z.string().min(1).max(255)).max(100).optional(),
    important_artifacts: z.array(z.string().min(1).max(2000)).max(100).optional(),
    recent_memory_keys: z.array(z.string().min(1).max(256)).max(100).optional(),
  }).strict(),
}).strict();

const orchestratorActivationFinishSchema = z.object({
  request_id: z.string().min(1).max(255),
}).strict();

const orchestratorContinuityWriteSchema = z.object({
  request_id: z.string().min(1).max(255),
  work_item_id: z.string().uuid().optional(),
  next_expected_actor: z.string().min(1).max(120).nullable().optional(),
  next_expected_action: z.string().min(1).max(4000).nullable().optional(),
  status_summary: z.string().min(1).max(4000).optional(),
  next_expected_event: z.string().min(1).max(255).optional(),
  blocked_on: z.array(z.string().min(1).max(4000)).max(50).optional(),
  active_subordinate_tasks: z.array(z.string().min(1).max(255)).max(100).optional(),
}).strict();

const uuidParamSchema = z.string().uuid();
const workItemIdParamSchema = uuidParamSchema;

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

function parseWorkItemIdOrThrow(value: string): string {
  const parsed = workItemIdParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('work_item_id must be a valid uuid');
  }
  return parsed.data;
}

function parseUuidParamOrThrow(value: string, label: string): string {
  const parsed = uuidParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`${label} must be a valid uuid`);
  }
  return parsed.data;
}

function normalizeUUIDList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values
    .map((value) => uuidParamSchema.safeParse(value))
    .filter((parsed): parsed is z.SafeParseSuccess<string> => parsed.success)
    .map((parsed) => parsed.data))];
}

function buildRecoverableApproveTaskNoop(
  taskScope: ActiveOrchestratorTaskScope,
  managedTask: Record<string, unknown>,
) {
  const taskState = readString(managedTask.state);
  if (!taskState || taskState === 'awaiting_approval') {
    return null;
  }

  return buildRecoverableGuidedNoop({
    reasonCode: 'task_not_awaiting_approval',
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: readString(managedTask.work_item_id) ?? taskScope.work_item_id ?? null,
      task_id: readString(managedTask.id) ?? null,
      current_stage: readString(managedTask.stage_name) ?? taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'inspect_task_state',
        target_type: 'task',
        target_id: readString(managedTask.id) ?? taskScope.id,
        why: 'The task is no longer waiting for approval.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'continue_current_cycle',
        target_type: readString(managedTask.work_item_id) ? 'work_item' : 'workflow',
        target_id: readString(managedTask.work_item_id) ?? taskScope.workflow_id,
        why: 'Route from the canonical task state instead of replaying a stale approval.',
        requires_orchestrator_judgment: true,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: readString(managedTask.work_item_id) ?? taskScope.work_item_id ?? null,
      task_id: readString(managedTask.id) ?? null,
    },
  });
}

function buildRecoverableMissingManagedTaskNoop(
  taskScope: ActiveOrchestratorTaskScope,
  managedTaskId: string,
) {
  const recoveryTargetId = taskScope.work_item_id ?? taskScope.workflow_id;
  const recoveryTargetType = taskScope.work_item_id ? 'work_item' : 'workflow';

  return buildRecoverableGuidedNoop({
    reasonCode: 'managed_task_not_found',
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: managedTaskId,
      current_stage: taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'inspect_current_cycle',
        target_type: recoveryTargetType,
        target_id: recoveryTargetId,
        why: 'The referenced specialist task is no longer present in the workflow state.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'reroute_from_current_state',
        target_type: recoveryTargetType,
        target_id: recoveryTargetId,
        why: 'Re-read the canonical workflow state before issuing another managed-task control action.',
        requires_orchestrator_judgment: true,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: managedTaskId,
    },
  });
}

function buildRecoverableGuidedNoop(input: {
  reasonCode: string;
  safetynetBehaviorId?: string;
  stateSnapshot: GuidedClosureStateSnapshot;
  suggestedNextActions: Array<{
    action_code: string;
    target_type: string;
    target_id: string;
    why: string;
    requires_orchestrator_judgment: boolean;
  }>;
  suggestedTargetIds: {
    workflow_id: string;
    work_item_id?: string | null;
    task_id?: string | null;
  };
}) {
  const response = buildRecoverableMutationResult({
    recovery_class: input.reasonCode,
    blocking: false,
    reason_code: input.reasonCode,
    state_snapshot: input.stateSnapshot,
    suggested_next_actions: input.suggestedNextActions,
    suggested_target_ids: input.suggestedTargetIds,
    callout_recommendations: [],
    closure_still_possible: true,
  });
  if (!input.safetynetBehaviorId) {
    return response;
  }
  return {
    ...response,
    safetynet_behavior_id: input.safetynetBehaviorId,
  };
}

async function resolveContinuityWorkItemId(
  app: FastifyInstance,
  tenantId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof orchestratorContinuityWriteSchema>,
): Promise<string> {
  if (body.work_item_id) {
    return body.work_item_id;
  }
  if (taskScope.work_item_id) {
    return taskScope.work_item_id;
  }

  const subordinateTaskIds = normalizeUUIDList(body.active_subordinate_tasks);
  if (subordinateTaskIds.length > 0) {
    const result = await app.pgPool.query<{ work_item_id: string }>(
      `SELECT DISTINCT work_item_id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = ANY($3::uuid[])
          AND work_item_id IS NOT NULL`,
      [tenantId, taskScope.workflow_id, subordinateTaskIds],
    );
    const resolvedCount = result.rowCount ?? result.rows.length;
    if (resolvedCount === 1) {
      return result.rows[0].work_item_id;
    }
    if (resolvedCount > 1) {
      throw new ValidationError(
        'This continuity update spans multiple work items; specify work_item_id explicitly',
        {
          recovery_hint: 'skip_optional_continuity_write',
          reason_code: 'ambiguous_work_item_scope',
        },
      );
    }
  }

  throw new ValidationError('This task is not linked to a work item');
}

const workspaceMemoryDeleteQuerySchema = z.object({
  request_id: z.string().min(1).max(255),
});

export const orchestratorControlRoutes: FastifyPluginAsync = async (app) => {
  const toolResultService = new WorkflowToolResultService(app.pgPool);
  const taskScopeService = new TaskAgentScopeService(app.pgPool);
  const activationCheckpointService = new OrchestratorActivationCheckpointService(app.pgPool);
  const workItemContinuityService = new WorkItemContinuityService(app.pgPool, app.logService);
  const artifactService = new ArtifactService(
    app.pgPool,
    createArtifactStorage(buildArtifactStorageConfig(app.config)),
    app.config.ARTIFACT_ACCESS_URL_TTL_SECONDS,
    app.config.ARTIFACT_PREVIEW_MAX_BYTES,
  );
  const taskMessageService = new OrchestratorTaskMessageService(
    app.pgPool,
    app.eventService,
    app.workerConnectionHub,
    {
      readStaleAfterMs: (tenantId) => readWorkerDispatchAckTimeoutMs(app.pgPool, tenantId),
    },
  );
  const handoffService = new HandoffService(app.pgPool);
  const playbookControlService = new PlaybookWorkflowControlService({
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
  });
  const recoveryHelpers = new GuidedClosureRecoveryHelpersService({
    pool: app.pgPool,
    eventService: app.eventService,
    taskService: app.taskService,
    workflowControlService: playbookControlService,
  });

  const withManagedSpecialistTask = async (
    identity: ApiKeyIdentity,
    orchestratorTaskId: string,
    managedTaskId: string,
  ) => {
    const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
      identity,
      orchestratorTaskId,
    );
    await loadManagedSpecialistTask(app, identity, taskScope.workflow_id, managedTaskId);
    return taskScope;
  };

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workItemCreateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const normalizedBody = await normalizeOrchestratorWorkItemCreateInput(
        app.pgPool,
        request.auth!.tenantId,
        taskScope,
        body,
      );
      const workItem = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'create_work_item',
        body.request_id,
        (client) =>
          createWorkflowWorkItemOrNoop(
            app,
            request.auth!,
            taskScope,
            taskScope.workflow_id,
            normalizedBody,
            client,
          ),
      );
      return reply.status(isRecoverableNotAppliedResult(workItem) ? 200 : 201).send({ data: workItem });
    },
  );

  app.patch(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(workItemUpdateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'update_work_item',
        body.request_id,
        (client) =>
          playbookControlService.updateWorkItem(
            request.auth!,
            taskScope.workflow_id,
            params.workItemId,
            body,
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/complete',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(workItemCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'complete_work_item',
        body.request_id,
        async (client) => {
          try {
            return await playbookControlService.completeWorkItem(
              request.auth!,
              taskScope.workflow_id,
              params.workItemId,
              {
                ...body,
                acting_task_id: taskScope.id,
              },
              client,
            );
          } catch (error) {
            const recoverableResult = buildRecoverableCompleteWorkItemNoopIfNotReady({
              error,
              taskScope,
              workItemId: params.workItemId,
            });
            if (recoverableResult) {
              return recoverableResult;
            }
            throw error;
          }
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/close-with-callouts',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(workItemCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'close_work_item_with_callouts',
        body.request_id,
        async (client) => {
          try {
            return await recoveryHelpers.closeWorkItemWithCallouts(
              request.auth!,
              taskScope.workflow_id,
              params.workItemId,
              {
                ...body,
                acting_task_id: taskScope.id,
              },
              client,
            );
          } catch (error) {
            const recoverableResult = buildRecoverableCompleteWorkItemNoopIfNotReady({
              error,
              taskScope,
              workItemId: params.workItemId,
            });
            if (recoverableResult) {
              return recoverableResult;
            }
            throw error;
          }
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/reopen-for-missing-handoff',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(reopenWorkItemForMissingHandoffSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'reopen_work_item_for_missing_handoff',
        body.request_id,
        (client) =>
          recoveryHelpers.reopenWorkItemForMissingHandoff(
            request.auth!,
            taskScope.workflow_id,
            params.workItemId,
            { reason: body.reason },
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/waive-preferred-step',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const body = parseOrThrow(waivePreferredStepSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'waive_preferred_step',
        body.request_id,
        (client) =>
          recoveryHelpers.waivePreferredStep(
            request.auth!,
            taskScope.workflow_id,
            params.workItemId,
            {
              code: body.code,
              reason: body.reason,
              summary: body.summary,
              role: body.role,
            },
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/continuity',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const workItemId = parseWorkItemIdOrThrow(params.workItemId);
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const workItem = await app.workflowService.getWorkflowWorkItem(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      return {
        data: {
          id: workItem.id,
          stage_name: workItem.stage_name ?? null,
          column_id: workItem.column_id ?? null,
          owner_role: workItem.owner_role ?? null,
          next_expected_actor: workItem.next_expected_actor ?? null,
          next_expected_action: workItem.next_expected_action ?? null,
          rework_count: workItem.rework_count ?? 0,
          escalation_status: workItem.escalation_status ?? null,
          latest_handoff_completion: workItem.latest_handoff_completion ?? null,
          latest_handoff_resolution: workItem.latest_handoff_resolution ?? null,
          unresolved_findings: workItem.unresolved_findings ?? [],
          focus_areas: workItem.focus_areas ?? [],
          known_risks: workItem.known_risks ?? [],
          gate_status: workItem.gate_status ?? null,
          gate_decision_feedback: workItem.gate_decision_feedback ?? null,
          gate_decided_at: workItem.gate_decided_at ?? null,
          completed_at: workItem.completed_at ?? null,
        },
      };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/handoffs',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const workItemId = parseWorkItemIdOrThrow(params.workItemId);
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      await app.workflowService.getWorkflowWorkItem(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      const data = await handoffService.listWorkItemHandoffs(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      return { data };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/work-items/:workItemId/handoffs/latest',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; workItemId: string };
      const workItemId = parseWorkItemIdOrThrow(params.workItemId);
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      await app.workflowService.getWorkflowWorkItem(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      const data = await handoffService.getLatestWorkItemHandoff(
        request.auth!.tenantId,
        taskScope.workflow_id,
        workItemId,
      );
      return { data };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      const task = await loadManagedSpecialistTask(
        app,
        request.auth!,
        taskScope.workflow_id,
        params.managedTaskId,
      );
      const artifacts = await artifactService.listTaskArtifacts(
        request.auth!.tenantId,
        params.managedTaskId,
      );
      return {
        data: {
          ...task,
          artifacts,
        },
      };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/artifacts',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const taskScope = await withManagedSpecialistTask(
        request.auth!,
        params.taskId,
        params.managedTaskId,
      );
      await loadManagedSpecialistTask(
        app,
        request.auth!,
        taskScope.workflow_id,
        params.managedTaskId,
      );
      const artifacts = await artifactService.listTaskArtifacts(
        request.auth!.tenantId,
        params.managedTaskId,
      );
      return { data: artifacts };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/approve',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMutationSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'approve_task',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          const noop = buildRecoverableApproveTaskNoop(taskScope, managedTask);
          if (noop) {
            return noop;
          }
          return app.taskService.approveTask(request.auth!, managedTaskId, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/approve-output',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMutationSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'approve_task_output',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.approveTaskOutput(request.auth!, managedTaskId, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/rework',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskReworkSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'request_rework',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.requestTaskChanges(request.auth!, managedTaskId, body, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/rerun-with-corrected-brief',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(rerunTaskWithCorrectedBriefSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'rerun_task_with_corrected_brief',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return recoveryHelpers.rerunTaskWithCorrectedBrief(
            request.auth!,
            managedTaskId,
            {
              request_id: body.request_id,
              corrected_input: body.corrected_input,
            },
            client,
          );
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/reattach-or-replace-stale-owner',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(reattachOrReplaceStaleOwnerSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'reattach_or_replace_stale_owner',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return recoveryHelpers.reattachOrReplaceStaleOwner(
            request.auth!,
            managedTaskId,
            body,
            client,
          );
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/retry',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskRetrySchema.safeParse(request.body ?? {}));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'retry_task',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.retryTask(request.auth!, managedTaskId, body, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/cancel',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMutationSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'cancel_task',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.cancelTask(request.auth!, managedTaskId, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/reassign',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskReassignSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'reassign_task',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.reassignTask(request.auth!, managedTaskId, body, client);
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/escalate-to-human',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskEscalateSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'escalate_to_human',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.escalateTask(
            request.auth!,
            managedTaskId,
            {
              reason: body.reason,
              context: body.context,
              recommendation: body.recommendation,
              blocking_task_id: body.blocking_task_id,
              urgency: body.urgency,
              escalation_target: 'human',
            },
            client,
          );
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorTaskCreateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const normalizedBody = await normalizeOrchestratorTaskCreateInput(
        app.pgPool,
        request.auth!.tenantId,
        taskScope,
        body,
      );
      const createTaskContext = await loadOrchestratorCreateWorkItemContext(
        app.pgPool,
        request.auth!.tenantId,
        taskScope.workflow_id,
        taskScope.activation_id,
      );
      const task = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'create_task',
        body.request_id,
        async (client) => {
          const createInput = {
            ...normalizedBody,
            workflow_id: taskScope.workflow_id,
            workspace_id: taskScope.workspace_id ?? undefined,
            activation_id: taskScope.activation_id ?? undefined,
            is_orchestrator_task: false,
            metadata: {
              ...(normalizedBody.metadata ?? {}),
              created_by_orchestrator_task_id: taskScope.id,
              orchestrator_activation_id: taskScope.activation_id,
            },
          };

          const existingReworkTaskId = await loadExistingReworkTaskForAssessmentRequest(
            client,
            request.auth!.tenantId,
            taskScope.workflow_id,
            createTaskContext,
            createInput,
          );
          if (existingReworkTaskId) {
            return app.taskService.getTask(request.auth!.tenantId, existingReworkTaskId) as Promise<Record<string, unknown>>;
          }

          const existingReviewTaskId = await loadExistingReviewTaskForSameRevision(
            client,
            request.auth!.tenantId,
            taskScope.workflow_id,
            createInput,
          );
          if (existingReviewTaskId) {
            return app.taskService.getTask(request.auth!.tenantId, existingReviewTaskId) as Promise<Record<string, unknown>>;
          }

          const duplicateAppliedAssessmentRequestNoop = await buildRecoverableCreateTaskNoopIfAssessmentRequestAlreadyApplied(
            client,
            request.auth!.tenantId,
            taskScope.workflow_id,
            taskScope,
            createTaskContext,
            createInput,
          );
          if (duplicateAppliedAssessmentRequestNoop) {
            return duplicateAppliedAssessmentRequestNoop;
          }

          const verificationNotReadyNoop = await buildRecoverableCreateTaskNoopIfNotReady(
            client,
            request.auth!.tenantId,
            taskScope.workflow_id,
            taskScope,
            createInput,
          );
          if (verificationNotReadyNoop) {
            return verificationNotReadyNoop;
          }

          return app.taskService.createTask(
            request.auth!,
            createInput,
            client,
          );
        },
      );
      return reply.status(isRecoverableNotAppliedResult(task) ? 200 : 201).send({ data: task });
    },
  );

  app.patch(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/input',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskInputUpdateSchema.safeParse(request.body));
      const managedTaskId = parseUuidParamOrThrow(params.managedTaskId, 'managed task id');
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'update_task_input',
        body.request_id,
        async (client) => {
          const managedTask = await loadManagedSpecialistTaskOrRecoverableNoop(
            app,
            request.auth!,
            taskScope,
            managedTaskId,
          );
          if (isRecoverableNotAppliedResult(managedTask)) {
            return managedTask;
          }
          return app.taskService.updateTaskInput(
            request.auth!.tenantId,
            managedTaskId,
            body.input,
            client,
          );
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/tasks/:managedTaskId/message',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; managedTaskId: string };
      const body = parseOrThrow(orchestratorTaskMessageSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'send_task_message',
        body.request_id,
        (client) =>
          taskMessageService.prepareMessage(
            request.auth!,
            taskScope,
            params.managedTaskId,
            body,
            client,
          ),
      );
      const delivered =
        (await taskMessageService.deliverPendingByRequestId(
          request.auth!,
          taskScope.workflow_id,
          body.request_id,
        )) ?? stored;
      const finalResponse = await toolResultService.replaceResult(
        request.auth!.tenantId,
        taskScope.workflow_id,
        'send_task_message',
        body.request_id,
        delivered,
      );
      return { data: finalResponse };
    },
  );

  app.get(
    '/api/v1/orchestrator/tasks/:taskId/workflow/budget',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      return {
        data: await app.workflowService.getWorkflowBudget(request.auth!.tenantId, taskScope.workflow_id),
      };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/stages/:stageName/request-gate',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; stageName: string };
      const body = parseOrThrow(gateRequestSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'request_gate_approval',
        body.request_id,
        async (client) => {
          try {
            return await playbookControlService.requestStageGateApproval(
              request.auth!,
              taskScope.workflow_id,
              params.stageName,
              body,
              client,
            );
          } catch (error) {
            const advisory = await buildUnconfiguredGateApprovalAdvisory(
              app,
              request.auth!,
              taskScope,
              params.stageName,
              body,
              client,
              error,
            );
            if (advisory) {
              return advisory;
            }
            throw error;
          }
        },
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/stages/:stageName/advance',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; stageName: string };
      const body = parseOrThrow(stageAdvanceSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'advance_stage',
        body.request_id,
        (client) =>
          playbookControlService.advanceStage(
            request.auth!,
            taskScope.workflow_id,
            params.stageName,
            body,
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/workflow/complete',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workflowCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'complete_workflow',
        body.request_id,
        (client) =>
          completeWorkflowOrNoop(
            request.auth!,
            taskScope,
            body,
            client,
            playbookControlService,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/workflow/close-with-callouts',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workflowCompleteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'close_workflow_with_callouts',
        body.request_id,
        (client) =>
          recoveryHelpers.closeWorkflowWithCallouts(
            request.auth!,
            taskScope.workflow_id,
            body,
            client,
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/memory',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(workspaceMemoryWriteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      if (!taskScope.workspace_id) {
        throw new ValidationError('This workflow is not linked to a workspace');
      }
      const memoryEntries =
        'updates' in body
          ? Object.entries(body.updates).map(([key, value]) => ({ key, value }))
          : [{ key: body.key, value: body.value }];
      assertWorkspaceMemoryWritesAreDurableKnowledge(memoryEntries);
      if (body.work_item_id) {
        await app.workflowService.getWorkflowWorkItem(
          request.auth!.tenantId,
          taskScope.workflow_id,
          body.work_item_id,
        );
      }
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'memory_write',
        body.request_id,
        (client) =>
          'updates' in body
            ? app.workspaceService.patchWorkspaceMemoryEntries(
                request.auth!,
                taskScope.workspace_id as string,
                Object.entries(body.updates).map(([key, value]) => ({
                  key,
                  value,
                  context: {
                    workflow_id: taskScope.workflow_id,
                    work_item_id: body.work_item_id ?? taskScope.work_item_id,
                    task_id: taskScope.id,
                    stage_name: taskScope.stage_name,
                  },
                })),
                client,
              )
            : app.workspaceService.patchWorkspaceMemory(
                request.auth!,
                taskScope.workspace_id as string,
                {
                  ...body,
                  context: {
                    workflow_id: taskScope.workflow_id,
                    work_item_id: body.work_item_id ?? taskScope.work_item_id,
                    task_id: taskScope.id,
                    stage_name: taskScope.stage_name,
                  },
                },
                client,
              ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/activation-checkpoint',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorActivationCheckpointSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'activation_checkpoint_write',
        body.request_id,
        (client) =>
          activationCheckpointService.persistCheckpoint(
            request.auth!.tenantId,
            taskScope.id,
            {
              ...body.activation_checkpoint,
              activation_id: body.activation_checkpoint.activation_id ?? taskScope.activation_id,
            },
            client,
          ).then((checkpoint) => ({
            last_activation_checkpoint: checkpoint,
          })),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/activation-finish',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorActivationFinishSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'activation_finish',
        body.request_id,
        (client) =>
          activationCheckpointService.persistDerivedCheckpoint(
            request.auth!.tenantId,
            {
              task_id: taskScope.id,
              workflow_id: taskScope.workflow_id,
              work_item_id: taskScope.work_item_id,
              activation_id: taskScope.activation_id,
            },
            client,
          ).then((checkpoint) => ({
            last_activation_checkpoint: checkpoint,
          })),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/continuity',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(orchestratorContinuityWriteSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      const workItemId = await resolveContinuityWorkItemId(
        app,
        request.auth!.tenantId,
        taskScope,
        body,
      );
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'continuity_write',
        body.request_id,
        (client) =>
          workItemContinuityService.persistOrchestratorFinishState(
            request.auth!.tenantId,
            {
              ...taskScope,
              work_item_id: workItemId,
              role: 'orchestrator',
            },
            body,
            client,
          ) as Promise<Record<string, unknown>>,
      );
      return { data: stored };
    },
  );

  app.delete(
    '/api/v1/orchestrator/tasks/:taskId/memory/:key',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => {
      const params = request.params as { taskId: string; key: string };
      const query = parseOrThrow(workspaceMemoryDeleteQuerySchema.safeParse(request.query));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );
      if (!taskScope.workspace_id) {
        throw new ValidationError('This workflow is not linked to a workspace');
      }
      const stored = await runIdempotentMutation(
        app,
        toolResultService,
        request.auth!.tenantId,
        taskScope.workflow_id,
        'memory_delete',
        query.request_id,
        (client) =>
          app.workspaceService.removeWorkspaceMemory(
            request.auth!,
            taskScope.workspace_id as string,
            params.key,
            client,
            {
              workflow_id: taskScope.workflow_id,
              work_item_id: taskScope.work_item_id,
              task_id: taskScope.id,
              stage_name: taskScope.stage_name,
            },
          ),
      );
      return { data: stored };
    },
  );

  app.post(
    '/api/v1/orchestrator/tasks/:taskId/workflows',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request, reply) => {
      const params = request.params as { taskId: string };
      const body = parseOrThrow(childWorkflowCreateSchema.safeParse(request.body));
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        request.auth!,
        params.taskId,
      );

      let workflow: Record<string, unknown>;
      let statusCode = 201;
      const existing = body.request_id
        ? await loadExistingChildWorkflow(
            app,
            request.auth!,
            taskScope.workflow_id,
            body.request_id,
          )
        : null;
      if (existing) {
        workflow = existing;
        statusCode = 200;
      } else {
        try {
          workflow = await app.workflowService.createWorkflow(request.auth!, {
            playbook_id: body.playbook_id,
            workspace_id: taskScope.workspace_id ?? undefined,
            name: body.name,
            parameters: body.parameters,
            metadata: {
              ...(body.metadata ?? {}),
              parent_workflow_id: taskScope.workflow_id,
              parent_orchestrator_task_id: taskScope.id,
              parent_context: body.parent_context ?? null,
              create_request_id: body.request_id,
            },
            config_overrides: body.config_overrides,
            instruction_config: body.instruction_config,
          });
        } catch (error) {
          if (!body.request_id || !isWorkflowCreateRequestConflict(error)) {
            throw error;
          }
          const conflicted = await loadExistingChildWorkflow(
            app,
            request.auth!,
            taskScope.workflow_id,
            body.request_id,
          );
          if (!conflicted) {
            throw error;
          }
          workflow = conflicted;
          statusCode = 200;
        }
      }

      await normalizeOrchestratorChildWorkflowLinkage(
        app.pgPool,
        request.auth!.tenantId,
        {
          parentWorkflowId: taskScope.workflow_id,
          parentOrchestratorTaskId: taskScope.id,
          parentOrchestratorActivationId: taskScope.activation_id,
          parentWorkItemId: taskScope.work_item_id,
          parentStageName: taskScope.stage_name,
          parentContext: body.parent_context,
        },
        String(workflow.id),
      );

      return reply.status(statusCode).send({ data: workflow });
    },
  );
};

async function runIdempotentMutation<T extends Record<string, unknown>>(
  app: FastifyInstance,
  toolResultService: WorkflowToolResultService,
  tenantId: string,
  workflowId: string,
  toolName: string,
  requestId: string | undefined,
  run: (client: import('../../db/database.js').DatabaseClient) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId) {
    const client = await app.pgPool.connect();
    try {
      await client.query('BEGIN');
      const response = await run(client);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const client = await app.pgPool.connect();
  try {
    await client.query('BEGIN');
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
    const response = await run(client);
    const stored = await toolResultService.storeResult(
      tenantId,
      workflowId,
      toolName,
      normalizedRequestId,
      response,
      client,
    );
    await client.query('COMMIT');
    return stored as T;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createWorkflowWorkItemOrNoop(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  workflowId: string,
  input: z.infer<typeof workItemCreateSchema>,
  client: import('../../db/database.js').DatabaseClient,
): Promise<Record<string, unknown>> {
  try {
    return await app.workflowService.createWorkflowWorkItem(
      identity,
      workflowId,
      input,
      client,
    );
  } catch (error) {
    const noop = buildRecoverableCreateWorkItemNoop(taskScope, input, error);
    if (noop) {
      return noop;
    }
    throw error;
  }
}

async function completeWorkflowOrNoop(
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workflowCompleteSchema>,
  client: import('../../db/database.js').DatabaseClient,
  playbookControlService: PlaybookWorkflowControlService,
): Promise<Record<string, unknown>> {
  try {
    return await playbookControlService.completeWorkflow(
      identity,
      taskScope.workflow_id,
      input,
      client,
    );
  } catch (error) {
    const noop = buildRecoverableCompleteWorkflowNoopIfNotReady({
      error,
      taskScope,
    });
    if (noop) {
      return noop;
    }
    throw error;
  }
}

async function buildUnconfiguredGateApprovalAdvisory(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  stageName: string,
  input: z.infer<typeof gateRequestSchema>,
  client: import('../../db/database.js').DatabaseClient,
  error: unknown,
): Promise<Record<string, unknown> | null> {
  const reasonCode = classifyUnconfiguredGateApprovalReason(error);
  if (!reasonCode) {
    return null;
  }

  const message = error instanceof Error ? error.message : 'Approval stage is not configured';
  const stateSnapshot: GuidedClosureStateSnapshot = {
    workflow_id: taskScope.workflow_id,
    work_item_id: taskScope.work_item_id ?? null,
    task_id: taskScope.id,
    current_stage: taskScope.stage_name ?? null,
    active_blocking_controls: [],
    active_advisory_controls: [],
  };
  const recovery = buildRecoverableMutationResult({
    recovery_class: reasonCode,
    blocking: false,
    reason_code: reasonCode,
    state_snapshot: stateSnapshot,
    suggested_next_actions: [
      {
        action_code: 'continue_work',
        target_type: 'work_item',
        target_id: taskScope.work_item_id ?? taskScope.workflow_id,
        why: 'The stage has no configured blocking approval gate.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'record_callout',
        target_type: 'workflow',
        target_id: taskScope.workflow_id,
        why: 'Persist the advisory concern if the workflow closes without a separate approval.',
        requires_orchestrator_judgment: true,
      },
    ],
    suggested_target_ids: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: taskScope.id,
    },
    callout_recommendations: [
      {
        code: reasonCode,
        summary: message,
      },
    ],
    closure_still_possible: true,
  });
  const advisory = {
    ...recovery,
    advisory: true,
    advisory_event_type: 'workflow.advisory_recorded',
    advisory_kind: 'approval_not_configured',
    advisory_recorded: true,
    blocking: false,
    configured: false,
    control_type: 'approval',
    message,
    reason_code: reasonCode,
    request_summary: input.summary.trim(),
    stage_name: stageName,
    status: 'ignored_not_configured',
    task_id: taskScope.id,
    work_item_id: taskScope.work_item_id ?? null,
    workflow_id: taskScope.workflow_id,
  } satisfies Record<string, unknown>;

  await app.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'workflow.advisory_recorded',
      entityType: 'workflow',
      entityId: taskScope.workflow_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: advisory,
    },
    client,
  );

  return advisory;
}

function classifyUnconfiguredGateApprovalReason(error: unknown): string | null {
  if (error instanceof ValidationError && error.message.includes('does not require a human gate')) {
    return 'approval_not_configured';
  }
  if (error instanceof NotFoundError && error.message.includes('Workflow stage')) {
    return 'approval_not_configured';
  }
  return null;
}

function buildRecoverableCreateWorkItemNoop(
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workItemCreateSchema>,
  error: unknown,
): Record<string, unknown> | null {
  if (!(error instanceof ValidationError)) {
    return null;
  }

  const message = error.message;
  const reasonCode = classifyRecoverableCreateWorkItemReason(message);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable create_work_item noop returned',
    { stage_name: input.stage_name, reason_code: reasonCode },
  );

  return buildRecoverableGuidedNoop({
    reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? input.parent_work_item_id ?? null,
      task_id: taskScope.id,
      current_stage: taskScope.stage_name ?? input.stage_name,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: recoverableCreateWorkItemActions(reasonCode, taskScope, input),
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? input.parent_work_item_id ?? null,
      task_id: taskScope.id,
    },
  });
}

function classifyRecoverableCreateWorkItemReason(message: string): string | null {
  if (message.includes('still has non-terminal tasks')) {
    return 'predecessor_not_ready';
  }
  if (message.includes('still awaits gate approval')) {
    return 'predecessor_waiting_for_gate';
  }
  if (message.includes('has a full handoff')) {
    return 'predecessor_waiting_for_handoff';
  }
  return null;
}

function classifyRecoverableCompleteWorkItemReason(message: string): string | null {
  if (message.includes('while task') && message.includes('is still')) {
    return 'work_item_tasks_not_ready';
  }
  if (message.includes('while required') && message.includes('is still pending')) {
    return 'work_item_waiting_for_continuation';
  }
  return null;
}

function classifyRecoverableCompleteWorkflowReason(message: string): string | null {
  if (message.includes('Only planned playbook workflows can be completed by the orchestrator')) {
    return 'workflow_lifecycle_not_closable';
  }
  return null;
}

function recoverableCompleteWorkflowActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
) {
  switch (reasonCode) {
    case 'workflow_lifecycle_not_closable':
    default:
      return [
        {
          action_code: 'inspect_workflow_state',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'The workflow lifecycle and state determine whether global closure is legal.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'continue_ongoing_workflow',
          target_type: 'workflow',
          target_id: taskScope.workflow_id,
          why: 'Ongoing workflows stay open after the current cycle settles; record callouts and wait for the next actionable event instead of forcing workflow completion.',
          requires_orchestrator_judgment: true,
        },
      ];
  }
}

function buildRecoverableCompleteWorkflowNoopIfNotReady(input: {
  error: unknown;
  taskScope: ActiveOrchestratorTaskScope;
}) {
  if (!(input.error instanceof ConflictError || input.error instanceof ValidationError)) {
    return null;
  }
  const reasonCode = classifyRecoverableCompleteWorkflowReason(input.error.message);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable complete_workflow noop returned',
    { workflow_id: input.taskScope.workflow_id, reason_code: reasonCode },
  );
  return buildRecoverableGuidedNoop({
    reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.taskScope.work_item_id ?? null,
      task_id: input.taskScope.id,
      current_stage: input.taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: recoverableCompleteWorkflowActions(
      reasonCode,
      input.taskScope,
    ),
    suggestedTargetIds: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.taskScope.work_item_id ?? null,
      task_id: input.taskScope.id,
    },
  });
}

function recoverableCompleteWorkItemActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
  workItemId: string,
) {
  switch (reasonCode) {
    case 'work_item_waiting_for_continuation':
      return [
        {
          action_code: 'inspect_current_work_item',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'The current work item still has unresolved continuity that blocks closure.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'route_pending_current_stage_action',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'Resolve the pending current-stage continuation before attempting closure again.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'work_item_tasks_not_ready':
    default:
      return [
        {
          action_code: 'inspect_current_work_item',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'The current work item state determines whether closure is legal yet.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_current_work_item_tasks',
          target_type: 'work_item',
          target_id: workItemId,
          why: 'Wait for in-flight specialist work on the current work item to settle before closing it.',
          requires_orchestrator_judgment: false,
        },
      ];
  }
}

function buildRecoverableCompleteWorkItemNoopIfNotReady(input: {
  error: unknown;
  taskScope: ActiveOrchestratorTaskScope;
  workItemId: string;
}) {
  if (!(input.error instanceof ValidationError)) {
    return null;
  }
  const reasonCode = classifyRecoverableCompleteWorkItemReason(input.error.message);
  if (!reasonCode) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable complete_work_item noop returned',
    { work_item_id: input.workItemId, reason_code: reasonCode },
  );
  return buildRecoverableGuidedNoop({
    reasonCode,
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.workItemId,
      task_id: input.taskScope.id,
      current_stage: input.taskScope.stage_name ?? null,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: recoverableCompleteWorkItemActions(
      reasonCode,
      input.taskScope,
      input.workItemId,
    ),
    suggestedTargetIds: {
      workflow_id: input.taskScope.workflow_id,
      work_item_id: input.workItemId,
      task_id: input.taskScope.id,
    },
  });
}

function recoverableCreateWorkItemActions(
  reasonCode: string,
  taskScope: ActiveOrchestratorTaskScope,
  input: z.infer<typeof workItemCreateSchema>,
) {
  const baseTargetId = input.parent_work_item_id ?? taskScope.work_item_id ?? taskScope.workflow_id;
  const baseTargetType = input.parent_work_item_id ? 'work_item' : 'workflow';
  switch (reasonCode) {
    case 'predecessor_waiting_for_gate':
      return [
        {
          action_code: 'inspect_predecessor',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'The predecessor stage still has an unresolved gate decision.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_gate_resolution',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Resolve or wait for the gate before creating successor work.',
          requires_orchestrator_judgment: false,
        },
      ];
    case 'predecessor_waiting_for_handoff':
      return [
        {
          action_code: 'inspect_predecessor',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'The predecessor still lacks a full handoff.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'rerun_predecessor_for_handoff',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Create or reroute the missing predecessor delivery so successor work can start legally.',
          requires_orchestrator_judgment: true,
        },
      ];
    case 'predecessor_not_ready':
    default:
      return [
        {
          action_code: 'inspect_predecessor',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'The predecessor state determines the next legal move.',
          requires_orchestrator_judgment: false,
        },
        {
          action_code: 'wait_for_predecessor_completion',
          target_type: baseTargetType,
          target_id: baseTargetId,
          why: 'Finish or clear predecessor work before routing successor work.',
          requires_orchestrator_judgment: false,
        },
      ];
  }
}

async function loadExistingChildWorkflow(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  parentWorkflowId: string,
  requestId: string,
) {
  const result = await app.pgPool.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND metadata->>'parent_workflow_id' = $2
        AND metadata->>'create_request_id' = $3
      LIMIT 1`,
    [identity.tenantId, parentWorkflowId, requestId],
  );
  const workflowId = result.rows[0]?.id;
  if (!workflowId) {
    return null;
  }
  return app.workflowService.getWorkflow(identity.tenantId, workflowId);
}

function isWorkflowCreateRequestConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === 'idx_workflows_parent_create_request';
}

async function loadManagedSpecialistTask(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  workflowId: string,
  taskId: string,
) {
  const managedTaskId = parseUuidParamOrThrow(taskId, 'managed task id');
  const task = await app.taskService.getTask(identity.tenantId, managedTaskId) as Record<string, unknown>;
  if (task.workflow_id !== workflowId) {
    throw new ValidationError('Managed task must belong to the orchestrator workflow');
  }
  if (task.is_orchestrator_task) {
    throw new ValidationError('Managed task must be a specialist task');
  }
  return task;
}

async function loadManagedSpecialistTaskOrRecoverableNoop(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  taskId: string,
): Promise<Record<string, unknown>> {
  try {
    return await loadManagedSpecialistTask(app, identity, taskScope.workflow_id, taskId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return buildRecoverableMissingManagedTaskNoop(
        taskScope,
        parseUuidParamOrThrow(taskId, 'managed task id'),
      );
    }
    throw error;
  }
}

interface OrchestratorCreateWorkItemContext {
  lifecycle: string | null;
  event_type: string | null;
  payload: Record<string, unknown>;
}

interface ReviewedTaskContextRow {
  id: string;
  rework_count: number | null;
  input: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  is_orchestrator_task: boolean | null;
}

interface ReviewedTaskReadinessRow extends ReviewedTaskContextRow {
  state: string | null;
}

interface ExistingReviewTaskRow {
  id: string;
}

interface ExistingReworkTaskRow {
  id: string;
}

interface ActivationTaskReviewRequestStateRow {
  id: string;
  role: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  metadata: Record<string, unknown> | null;
}

interface ReviewRequestTaskContextRow {
  id: string;
  work_item_id: string | null;
  stage_name: string | null;
}

async function normalizeOrchestratorWorkItemCreateInput(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof workItemCreateSchema>,
): Promise<z.infer<typeof workItemCreateSchema>> {
  if (body.parent_work_item_id) {
    return body;
  }

  const context = await loadOrchestratorCreateWorkItemContext(
    pool,
    tenantId,
    taskScope.workflow_id,
    taskScope.activation_id,
  );
  const fallbackParentId = taskScope.work_item_id ?? readString(context.payload.work_item_id);
  if (!fallbackParentId) {
    return body;
  }
  if (context.lifecycle !== 'planned') {
    return body;
  }
  if (
    !shouldDefaultParentWorkItemId(context.event_type, context.payload)
    && !shouldDefaultCrossStageParentWorkItemId(taskScope, body, context.payload)
  ) {
    return body;
  }
  return {
    ...body,
    parent_work_item_id: fallbackParentId,
  };
}

async function normalizeOrchestratorTaskCreateInput(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  const topLevelNormalizedBody = hoistTopLevelAssessmentSubjectLinkage(body);
  const stageAlignedBody = await alignOrchestratorTaskCreateWorkItemToStage(
    pool,
    tenantId,
    taskScope.workflow_id,
    topLevelNormalizedBody,
  );
  const expectationTypedBody = await inferWorkItemExpectedTaskType(
    pool,
    tenantId,
    taskScope.workflow_id,
    stageAlignedBody,
  );
  const explicitLinkageBody = await normalizeExplicitAssessmentSubjectTaskLinkage(
    pool,
    tenantId,
    taskScope.workflow_id,
    expectationTypedBody,
  );
  if (hasExplicitReviewedTaskReference(explicitLinkageBody.input, explicitLinkageBody.metadata)) {
    return explicitLinkageBody;
  }

  const existingInput = explicitLinkageBody.input ?? {};
  const explicitAssessmentLinkage = readAssessmentSubjectLinkage(existingInput, explicitLinkageBody.metadata);
  const context = await loadOrchestratorCreateWorkItemContext(
    pool,
    tenantId,
    taskScope.workflow_id,
    taskScope.activation_id,
  );
  if (isReviewTaskCreate(explicitLinkageBody)) {
    const explicitTaskID = readString(existingInput.task_id);
    if (explicitTaskID) {
      const reviewTaskMetadata = await loadReviewedTaskMetadata(
      pool,
      tenantId,
      taskScope.workflow_id,
      explicitTaskID,
    );
      const resolvedLinkage = mergeAssessmentSubjectLinkage(reviewTaskMetadata, explicitAssessmentLinkage);
      return {
        ...explicitLinkageBody,
        input: buildAssessmentSubjectInput(existingInput, resolvedLinkage),
        metadata: buildAssessmentSubjectMetadata(explicitLinkageBody.metadata, resolvedLinkage, 'input_task_id_default'),
      };
    }
    const targetWorkItemSubject = await maybeLoadCrossStageTargetWorkItemAssessmentSubject(
      pool,
      tenantId,
      taskScope.workflow_id,
      explicitLinkageBody,
      context,
    );
    if (targetWorkItemSubject) {
      const resolvedLinkage = mergeAssessmentSubjectLinkage(targetWorkItemSubject, explicitAssessmentLinkage);
      return {
        ...explicitLinkageBody,
        input: buildAssessmentSubjectInput(explicitLinkageBody.input, resolvedLinkage),
        metadata: buildAssessmentSubjectMetadata(
          explicitLinkageBody.metadata,
          resolvedLinkage,
          'target_work_item_delivery_default',
        ),
      };
    }
    if (!isReviewLinkActivation(context.event_type)) {
      return body;
    }

    const reviewedTaskId = readString(context.payload.task_id);
    if (!reviewedTaskId) {
      return stageAlignedBody;
    }

    const reviewTaskMetadata = await loadReviewedTaskMetadata(
      pool,
      tenantId,
      taskScope.workflow_id,
      reviewedTaskId,
    );
    const resolvedLinkage = mergeAssessmentSubjectLinkage(reviewTaskMetadata, explicitAssessmentLinkage);

    return {
      ...explicitLinkageBody,
      input: buildAssessmentSubjectInput(explicitLinkageBody.input, resolvedLinkage),
      metadata: buildAssessmentSubjectMetadata(explicitLinkageBody.metadata, resolvedLinkage, 'activation_default'),
    };
  }

  if (!shouldDefaultActivationReviewedTaskLinkage(explicitLinkageBody, context.event_type)) {
    return explicitLinkageBody;
  }

  const reviewedTaskId = await loadActivationReviewedTaskId(
    pool,
    tenantId,
    taskScope.workflow_id,
    readString(context.payload.task_id),
  );
  if (!reviewedTaskId) {
    return stageAlignedBody;
  }

  const reviewedTaskMetadata = await loadReviewedTaskMetadata(
    pool,
    tenantId,
    taskScope.workflow_id,
    reviewedTaskId,
  );
  const resolvedLinkage = mergeAssessmentSubjectLinkage(reviewedTaskMetadata, explicitAssessmentLinkage);

  return {
    ...explicitLinkageBody,
    input: buildAssessmentSubjectInput(existingInput, resolvedLinkage),
    metadata: buildAssessmentSubjectMetadata(explicitLinkageBody.metadata, resolvedLinkage, 'activation_lineage_default'),
  };
}

async function inferWorkItemExpectedTaskType(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  if (body.type || !body.work_item_id || !body.role) {
    return body;
  }

  const result = await db.query<{
    next_expected_actor: string | null;
    next_expected_action: string | null;
  }>(
    `SELECT next_expected_actor, next_expected_action
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, body.work_item_id],
  );
  const row = result.rows[0];
  const expectedActor = readString(row?.next_expected_actor);
  const expectedAction = readString(row?.next_expected_action);
  if (!expectedActor || expectedActor !== body.role) {
    return body;
  }

  if (expectedAction === 'assess') {
    return { ...body, type: 'assessment' };
  }
  return body;
}

export async function normalizeExplicitAssessmentSubjectTaskLinkage(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  const explicitLinkage = readAssessmentSubjectLinkage(body.input ?? {}, body.metadata);
  if (!explicitLinkage.subjectTaskId || explicitLinkage.subjectRevision !== null) {
    return body;
  }

  const fallbackLinkage = await loadReviewedTaskMetadata(
    db,
    tenantId,
    workflowId,
    explicitLinkage.subjectTaskId,
  );
  const resolvedLinkage = mergeAssessmentSubjectLinkage(fallbackLinkage, explicitLinkage);
  return {
    ...body,
    input: buildAssessmentSubjectInput(body.input, resolvedLinkage),
    metadata: buildAssessmentSubjectMetadata(body.metadata, resolvedLinkage, 'explicit_subject_task_default'),
  };
}

function hoistTopLevelAssessmentSubjectLinkage(
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): z.infer<typeof orchestratorTaskCreateSchema> {
  const {
    subject_task_id,
    subject_work_item_id,
    subject_handoff_id,
    subject_revision,
    ...rest
  } = body;
  const topLevelLinkage = readAssessmentSubjectLinkage({
    subject_task_id,
    subject_work_item_id,
    subject_handoff_id,
    subject_revision,
  });
  if (
    topLevelLinkage.subjectTaskId === null
    && topLevelLinkage.subjectWorkItemId === null
    && topLevelLinkage.subjectHandoffId === null
    && topLevelLinkage.subjectRevision === null
  ) {
    return rest;
  }
  return {
    ...rest,
    input: buildAssessmentSubjectInput(rest.input, topLevelLinkage),
    metadata: buildAssessmentSubjectMetadata(rest.metadata, topLevelLinkage, 'top_level_create_task'),
  };
}

async function loadReviewedTaskMetadata(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  reviewedTaskId: string,
) {
  const result = await db.query<ReviewedTaskContextRow>(
    `SELECT id, rework_count, input, metadata, is_orchestrator_task
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, reviewedTaskId],
  );
  const row = result.rows[0];
  const taskKind = readWorkflowTaskKind(row?.metadata, Boolean(row?.is_orchestrator_task));
  if (taskKind === 'assessment' || taskKind === 'approval') {
    const explicitLinkage = readAssessmentSubjectLinkage(row?.input, row?.metadata);
    if (explicitLinkage.subjectTaskId) {
      return {
        subjectTaskId: explicitLinkage.subjectTaskId,
        subjectWorkItemId: explicitLinkage.subjectWorkItemId,
        subjectHandoffId: explicitLinkage.subjectHandoffId,
        subjectRevision: explicitLinkage.subjectRevision,
      };
    }
  }
  const deliverySubjectRevision = deriveReviewedDeliverySubjectRevision(row);
  return {
    subjectTaskId: row?.id ?? reviewedTaskId,
    subjectWorkItemId: null,
    subjectHandoffId: null,
    subjectRevision: deliverySubjectRevision,
  };
}

function deriveReviewedDeliverySubjectRevision(
  row: ReviewedTaskContextRow | undefined,
): number | null {
  const metadata = asRecord(row?.metadata);
  const input = asRecord(row?.input);
  const persistedRevision = readInteger(metadata.output_revision) ?? 0;
  const reworkDerivedRevision = (row?.rework_count ?? 0) + 1;
  const explicitRevision = readInteger(input.subject_revision) ?? 0;
  const subjectRevision = Math.max(persistedRevision, reworkDerivedRevision, explicitRevision);
  return subjectRevision > 0 ? subjectRevision : null;
}

async function maybeLoadCrossStageTargetWorkItemAssessmentSubject(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
  context: OrchestratorCreateWorkItemContext,
) {
  if (context.event_type !== 'task.handoff_submitted' || !body.work_item_id) {
    return null;
  }

  const activationWorkItemId = readString(context.payload.work_item_id);
  const activationStageName = readString(context.payload.stage_name);
  const changedWorkItem = activationWorkItemId !== null && activationWorkItemId !== body.work_item_id;
  const changedStage = activationStageName !== null && activationStageName !== body.stage_name;
  if (!changedWorkItem && !changedStage) {
    return null;
  }

  const result = await db.query<{
    subject_task_id: string | null;
    subject_work_item_id: string | null;
    subject_revision: number | null;
  }>(
    `SELECT th.role_data->>'subject_task_id' AS subject_task_id,
            NULLIF(th.role_data->>'subject_work_item_id', '') AS subject_work_item_id,
            NULLIF(COALESCE(NULLIF(th.role_data->>'subject_revision', '')::int, 0), 0) AS subject_revision
       FROM task_handoffs th
      WHERE th.tenant_id = $1
        AND th.workflow_id = $2
        AND th.work_item_id = $3
        AND th.completion = 'full'
        AND COALESCE(th.role_data->>'task_kind', 'delivery') = 'delivery'
      ORDER BY th.sequence DESC, th.created_at DESC
      LIMIT 1`,
    [tenantId, workflowId, body.work_item_id],
  );
  const row = result.rows[0];
  if (!row?.subject_task_id) {
    return null;
  }

  return {
    subjectTaskId: row.subject_task_id,
    subjectWorkItemId: row.subject_work_item_id ?? body.work_item_id,
    subjectHandoffId: null,
    subjectRevision: row.subject_revision ?? null,
  };
}

async function loadExistingReviewTaskForSameRevision(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
) {
  if (!isReviewTaskCreate(body) || !body.work_item_id) {
    return null;
  }

  const subjectTaskId = readSubjectTaskReference(body.input);
  const subjectRevision = readInteger(body.metadata?.subject_revision);
  if (!subjectTaskId || subjectRevision === null) {
    return null;
  }

  const result = await db.query<ExistingReviewTaskRow>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND role = $4
        AND state = ANY($5::task_state[])
        AND COALESCE(metadata->>'subject_task_id', '') = $6
        AND COALESCE((metadata->>'subject_revision')::integer, -1) = $7
      ORDER BY created_at DESC
      LIMIT 1`,
    [
      tenantId,
      workflowId,
      body.work_item_id,
      body.role,
      ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'completed'],
      subjectTaskId,
      subjectRevision,
    ],
  );
  return result.rows[0]?.id ?? null;
}

async function buildRecoverableCreateTaskNoopIfNotReady(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<Record<string, unknown> | null> {
  if (!isVerificationTaskCreate(body)) {
    return null;
  }

  const subjectTaskId = readSubjectTaskReference(body.input);
  if (!subjectTaskId) {
    return null;
  }

  const result = await db.query<ReviewedTaskReadinessRow>(
    `SELECT id, state, rework_count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, subjectTaskId],
  );
  const subjectTask = result.rows[0];
  if (!subjectTask || subjectTask.state === 'completed') {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable create_task noop returned because subject task is not ready',
    { workflow_id: workflowId, subject_task_id: subjectTask.id ?? subjectTaskId },
  );

  return buildRecoverableGuidedNoop({
    reasonCode: 'subject_task_not_ready',
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: taskScope.id,
      current_stage: body.stage_name,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'inspect_subject_task',
        target_type: 'task',
        target_id: subjectTask.id ?? subjectTaskId,
        why: 'The subject task has not produced a ready output yet.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'wait_for_subject_output',
        target_type: 'task',
        target_id: subjectTask.id ?? subjectTaskId,
        why: 'Dispatch the follow-up only after the current assessment or rework cycle resolves.',
        requires_orchestrator_judgment: false,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: subjectTask.id ?? subjectTaskId,
    },
  });
}

async function buildRecoverableCreateTaskNoopIfAssessmentRequestAlreadyApplied(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  taskScope: ActiveOrchestratorTaskScope,
  context: OrchestratorCreateWorkItemContext,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<Record<string, unknown> | null> {
  if (context.event_type !== 'task.output_pending_assessment') {
    return null;
  }

  const activationTaskRole = readString(context.payload.task_role);
  if (!activationTaskRole || activationTaskRole !== body.role) {
    return null;
  }

  const activationTaskId = readString(context.payload.task_id);
  if (!activationTaskId) {
    return null;
  }

  const activationTaskResult = await db.query<ActivationTaskReviewRequestStateRow>(
    `SELECT id, role, work_item_id, stage_name, metadata
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, activationTaskId],
  );
  const activationTask = activationTaskResult.rows[0];
  if (!activationTask) {
    return null;
  }
  if (!activationTask.role || activationTask.role !== body.role) {
    return null;
  }
  if (!activationTask.work_item_id || activationTask.work_item_id === body.work_item_id) {
    return null;
  }

  const assessmentRequestTaskId = readString(asRecord(activationTask.metadata).last_applied_assessment_request_task_id);
  if (!assessmentRequestTaskId) {
    return null;
  }

  const assessmentRequestTaskResult = await db.query<ReviewRequestTaskContextRow>(
    `SELECT id, work_item_id, stage_name
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [tenantId, workflowId, assessmentRequestTaskId],
  );
  const assessmentRequestTask = assessmentRequestTaskResult.rows[0];
  if (!assessmentRequestTask?.work_item_id || assessmentRequestTask.work_item_id !== body.work_item_id) {
    return null;
  }
  logSafetynetTriggered(
    NOT_READY_NOOP_RECOVERY_SAFETYNET,
    'recoverable create_task noop returned because assessment request was already applied',
    { workflow_id: workflowId, work_item_id: body.work_item_id },
  );

  return buildRecoverableGuidedNoop({
    reasonCode: 'assessment_request_already_applied',
    safetynetBehaviorId: NOT_READY_NOOP_RECOVERY_SAFETYNET.id,
    stateSnapshot: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: taskScope.id,
      current_stage: body.stage_name,
      active_blocking_controls: [],
      active_advisory_controls: [],
    },
    suggestedNextActions: [
      {
        action_code: 'continue_routing_from_reopened_task',
        target_type: 'task',
        target_id: activationTask.id,
        why: 'The reopened task already owns the requested rework path.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'inspect_assessment_request',
        target_type: 'task',
        target_id: assessmentRequestTask.id,
        why: 'The prior assessment request already established the follow-up contract.',
        requires_orchestrator_judgment: false,
      },
    ],
    suggestedTargetIds: {
      workflow_id: taskScope.workflow_id,
      work_item_id: body.work_item_id,
      task_id: activationTask.id,
    },
  });
}

function isRecoverableNotAppliedResult(value: Record<string, unknown>): boolean {
  return value.mutation_outcome === 'recoverable_not_applied';
}

async function loadExistingReworkTaskForAssessmentRequest(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  context: OrchestratorCreateWorkItemContext,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
) {
  if (context.event_type !== 'task.assessment_requested_changes') {
    return null;
  }

  const subjectTaskId = readString(context.payload.task_id);
  const subjectTaskRole = readString(context.payload.task_role);
  if (!subjectTaskId || !subjectTaskRole || body.role !== subjectTaskRole) {
    return null;
  }

  const result = await db.query<ExistingReworkTaskRow>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND role = $4
        AND state = ANY($5::task_state[])
      LIMIT 1`,
    [
      tenantId,
      workflowId,
      subjectTaskId,
      subjectTaskRole,
      ['pending', 'ready', 'claimed', 'in_progress', 'output_pending_assessment'],
    ],
  );
  return result.rows[0]?.id ?? null;
}

interface TaskCreateStageAlignedWorkItem {
  work_item_id: string;
  source: 'parent_stage_match' | 'child_stage_match' | null;
}

interface TaskCreateWorkItemStageContextRow {
  id: string;
  stage_name: string;
  parent_work_item_id: string | null;
  parent_id: string | null;
  parent_stage_name: string | null;
  workflow_lifecycle: string | null;
}

async function alignOrchestratorTaskCreateWorkItemToStage(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  workflowId: string,
  body: z.infer<typeof orchestratorTaskCreateSchema>,
): Promise<z.infer<typeof orchestratorTaskCreateSchema>> {
  const aligned = await resolveStageAlignedTaskWorkItemId(
    pool,
    tenantId,
    workflowId,
    body.work_item_id,
    body.stage_name,
  );
  if (aligned.source === null || aligned.work_item_id === body.work_item_id) {
    return body;
  }

  return {
    ...body,
    work_item_id: aligned.work_item_id,
    metadata: {
      ...(body.metadata ?? {}),
      stage_aligned_work_item_id_source: aligned.source,
    },
  };
}

async function resolveStageAlignedTaskWorkItemId(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  workflowId: string,
  workItemId: string,
  targetStageName: string,
): Promise<TaskCreateStageAlignedWorkItem> {
  const contextResult = await pool.query<TaskCreateWorkItemStageContextRow>(
    `SELECT wi.id,
            wi.stage_name,
            wi.parent_work_item_id,
            parent.id AS parent_id,
            parent.stage_name AS parent_stage_name,
            w.lifecycle AS workflow_lifecycle
       FROM workflow_work_items wi
       JOIN workflows w
         ON w.tenant_id = wi.tenant_id
        AND w.id = wi.workflow_id
       LEFT JOIN workflow_work_items parent
         ON parent.tenant_id = wi.tenant_id
        AND parent.workflow_id = wi.workflow_id
        AND parent.id = wi.parent_work_item_id
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1`,
    [tenantId, workflowId, workItemId],
  );
  const current = contextResult.rows[0];
  if (!current || current.workflow_lifecycle !== 'planned' || current.stage_name === targetStageName) {
    return { work_item_id: workItemId, source: null };
  }

  if (current.parent_id && current.parent_stage_name === targetStageName) {
    return {
      work_item_id: current.parent_id,
      source: 'parent_stage_match',
    };
  }

  const childResult = await pool.query<{ id: string }>(
    `SELECT id
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND parent_work_item_id = $3
        AND stage_name = $4
      ORDER BY updated_at DESC
      LIMIT 2`,
    [tenantId, workflowId, workItemId, targetStageName],
  );
  if ((childResult.rowCount ?? childResult.rows.length) === 1) {
    return {
      work_item_id: childResult.rows[0].id,
      source: 'child_stage_match',
    };
  }
  if ((childResult.rowCount ?? childResult.rows.length) > 1) {
    throw new ValidationError(
      `work_item_id '${workItemId}' does not match stage '${targetStageName}' and multiple child work items exist in the requested stage. Specify the exact target work_item_id.`,
    );
  }

  return { work_item_id: workItemId, source: null };
}

function shouldDefaultCrossStageParentWorkItemId(
  taskScope: ActiveOrchestratorTaskScope,
  body: z.infer<typeof workItemCreateSchema>,
  payload: Record<string, unknown>,
) {
  if (!readString(payload.work_item_id)) {
    return false;
  }
  const activationStageName = readString(payload.stage_name) ?? taskScope.stage_name;
  if (!activationStageName) {
    return false;
  }
  if (!body.stage_name) {
    return false;
  }
  return activationStageName !== body.stage_name;
}

function isReviewTaskCreate(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  return readWorkflowTaskCreateKind(body) === 'assessment';
}

function shouldDefaultActivationReviewedTaskLinkage(
  body: z.infer<typeof orchestratorTaskCreateSchema>,
  eventType: string | null,
) {
  return readWorkflowTaskCreateKind(body) !== 'orchestrator' && isReviewLinkActivation(eventType);
}

function isReviewLinkActivation(eventType: string | null) {
  return eventType === 'task.output_pending_assessment' || eventType === 'task.handoff_submitted';
}

function isVerificationTaskCreate(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  return body.type === 'test';
}

function readWorkflowTaskCreateKind(body: z.infer<typeof orchestratorTaskCreateSchema>) {
  if (body.type === 'assessment') {
    return 'assessment';
  }
  return readWorkflowTaskKind(body.metadata);
}

async function loadActivationReviewedTaskId(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  workflowId: string,
  activationTaskId: string | null,
): Promise<string | null> {
  if (!activationTaskId) {
    return null;
  }

  const result = await pool.query<{ input: Record<string, unknown> | null }>(
    `SELECT input
       FROM tasks
      WHERE tenant_id = $1
        AND id = $2
        AND workflow_id = $3
      LIMIT 1`,
    [tenantId, activationTaskId, workflowId],
  );
  if (!result.rowCount) {
    return activationTaskId;
  }

  return readSubjectTaskReference(result.rows[0].input ?? undefined) ?? activationTaskId;
}

async function loadOrchestratorCreateWorkItemContext(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  activationId: string | null,
): Promise<OrchestratorCreateWorkItemContext> {
  if (!activationId) {
    return {
      lifecycle: null,
      event_type: null,
      payload: {},
    };
  }

  const result = await db.query<OrchestratorCreateWorkItemContext>(
    `SELECT w.lifecycle,
            wa.event_type,
            COALESCE(wa.payload, '{}'::jsonb) AS payload
       FROM workflows w
       LEFT JOIN workflow_activations wa
         ON wa.tenant_id = w.tenant_id
        AND wa.workflow_id = w.id
        AND (wa.id = $3 OR wa.activation_id = $3)
      WHERE w.tenant_id = $1
        AND w.id = $2
      LIMIT 1`,
    [tenantId, workflowId, activationId],
  );
  const row = result.rows[0];
  return {
    lifecycle: row?.lifecycle ?? null,
    event_type: row?.event_type ?? null,
    payload: asRecord(row?.payload),
  };
}

function shouldDefaultParentWorkItemId(
  eventType: string | null,
  payload: Record<string, unknown>,
): boolean {
  if (!readString(payload.work_item_id)) {
    return false;
  }
  if (!eventType) {
    return false;
  }
  return new Set([
    'task.completed',
    'task.output_pending_assessment',
    'task.output_assessment.approved',
    'task.output_assessment.rejected',
    'stage.gate.approve',
    'stage.gate.reject',
    'work_item.created',
  ]).has(eventType);
}

function hasExplicitReviewedTaskReference(
  input: Record<string, unknown> | undefined,
  metadata?: Record<string, unknown> | undefined,
) {
  return hasExplicitAssessmentSubjectLinkage(input, metadata);
}

function readSubjectTaskReference(input: Record<string, unknown> | undefined) {
  return readAssessmentSubjectLinkage(input).subjectTaskId;
}

interface ChildWorkflowLinkage {
  parentWorkflowId: string;
  parentOrchestratorTaskId: string;
  parentOrchestratorActivationId: string | null;
  parentWorkItemId: string | null;
  parentStageName: string | null;
  parentContext?: string;
}

export async function normalizeOrchestratorChildWorkflowLinkage(
  pool: FastifyInstance['pgPool'],
  tenantId: string,
  linkage: ChildWorkflowLinkage,
  childWorkflowId: string,
): Promise<void> {
  const [parentResult, childResult] = await Promise.all([
    pool.query<{ metadata: Record<string, unknown> | null }>(
      'SELECT metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, linkage.parentWorkflowId],
    ),
    pool.query<{ metadata: Record<string, unknown> | null }>(
      'SELECT metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, childWorkflowId],
    ),
  ]);
  if (!parentResult.rowCount || !childResult.rowCount) {
    return;
  }

  const parentMetadata = asRecord(parentResult.rows[0].metadata);
  const childMetadata = asRecord(childResult.rows[0].metadata);
  const childWorkflowIds = dedupeStrings([
    ...readStringArray(parentMetadata.child_workflow_ids),
    childWorkflowId,
  ]);

  await Promise.all([
    pool.query(
      `UPDATE workflows
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        linkage.parentWorkflowId,
        {
          child_workflow_ids: childWorkflowIds,
          latest_child_workflow_id: childWorkflowId,
          latest_child_workflow_created_by_orchestrator_task_id: linkage.parentOrchestratorTaskId,
        },
      ],
    ),
    pool.query(
      `UPDATE workflows
          SET metadata = $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        childWorkflowId,
        {
          ...childMetadata,
          parent_workflow_id: linkage.parentWorkflowId,
          parent_orchestrator_task_id: linkage.parentOrchestratorTaskId,
          parent_orchestrator_activation_id: linkage.parentOrchestratorActivationId,
          parent_work_item_id: linkage.parentWorkItemId,
          parent_stage_name: linkage.parentStageName,
          parent_context: linkage.parentContext ?? childMetadata.parent_context ?? null,
          parent_link_kind: 'orchestrator_child',
        },
      ],
    ),
  ]);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
const NOT_READY_NOOP_RECOVERY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_NOT_READY_NOOP_RECOVERY_ID,
);
