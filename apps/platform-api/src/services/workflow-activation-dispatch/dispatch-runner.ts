import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '../../db/database.js';

import { logSafetynetTriggered } from '../safetynet/logging.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';

import { buildActivationTaskDefinition } from './task-definition.js';
import { ActivationStateStore } from './activation-state-store.js';
import { ActivationTaskStore } from './task-store.js';
import {
  buildActivationTaskRequestId,
  countDispatchableEvents,
  deriveActivationReason,
  derivePrimaryActivationEvent,
  findActivationAnchor,
  isActiveActivationConstraintError,
  isReadyForDispatch,
} from './helpers.js';
import type {
  ActivationTaskDefinition,
  ActivationTaskLoopContract,
  ActivationTaskRow,
  DispatchDependencies,
  DispatchOptions,
  ExistingActivationTaskResolution,
} from './types.js';

const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

interface DispatchActivationParams {
  tenantId: string;
  activationId: string;
  deps: DispatchDependencies;
  activationStateStore: ActivationStateStore;
  activationTaskStore: ActivationTaskStore;
  resolveExistingActivationTask: (
    tenantId: string,
    workflowId: string,
    activationId: string,
    requestId: string,
    taskDefinition: ActivationTaskDefinition,
    loopContract: ActivationTaskLoopContract,
    client: DatabaseClient,
  ) => Promise<ExistingActivationTaskResolution | null>;
  existingClient?: DatabaseClient;
  options?: DispatchOptions;
}

export async function dispatchActivation({
  tenantId,
  activationId,
  deps,
  activationStateStore,
  activationTaskStore,
  resolveExistingActivationTask,
  existingClient,
  options = {},
}: DispatchActivationParams): Promise<string | null> {
  const client = existingClient ?? (await deps.pool.connect());
  const ownsClient = existingClient === undefined;

  try {
    if (ownsClient) {
      await client.query('BEGIN');
    }

    const activation = await activationStateStore.lockQueuedActivation(
      tenantId,
      activationId,
      client,
    );
    if (!activation) {
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return null;
    }

    const hasActiveTask = await activationStateStore.hasActiveOrchestratorTask(
      activation.tenant_id,
      activation.workflow_id,
      client,
    );
    if (hasActiveTask) {
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return null;
    }

    const hasProcessingActivation = await activationStateStore.hasProcessingActivation(
      activation.tenant_id,
      activation.workflow_id,
      activation.id,
      client,
    );
    if (hasProcessingActivation) {
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return null;
    }

    const timingDefaults = await activationStateStore.readActivationTimingDefaults(client);
    if (!options.ignoreDelay && !isReadyForDispatch(activation, timingDefaults.activationDelayMs)) {
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return null;
    }

    const workflow = await activationStateStore.loadWorkflowForDispatch(
      activation.tenant_id,
      activation.workflow_id,
      client,
    );
    if (!workflow) {
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return null;
    }

    const activationBatch = await activationStateStore.claimActivationBatch(
      activation,
      timingDefaults.activationDelayMs,
      randomUUID(),
      client,
    );
    if (activationBatch.length === 0) {
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return null;
    }

    const activationAnchor = findActivationAnchor(activation.id, activationBatch);
    const activationReason = deriveActivationReason(activationBatch);
    const primaryEvent = derivePrimaryActivationEvent(activationAnchor, activationBatch);

    if (
      activationReason === 'heartbeat'
      && await activationStateStore.hasActiveSpecialistTask(
        activationAnchor.tenant_id,
        activationAnchor.workflow_id,
        client,
      )
    ) {
      await activationStateStore.completeHeartbeatWithoutDispatch(activationAnchor, client);
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return null;
    }

    const taskRequestId = buildActivationTaskRequestId(activationAnchor);
    const taskDefinition = buildActivationTaskDefinition(workflow, activationAnchor, activationBatch);
    const timeoutMinutes = await activationTaskStore.resolveDefaultTaskTimeoutMinutes(
      activationAnchor.tenant_id,
      client,
    );
    const loopContract = await activationTaskStore.resolveActivationTaskLoopContract(
      activationAnchor.tenant_id,
      workflow,
      client,
    );
    const taskResult = await client.query<ActivationTaskRow>(
      `INSERT INTO tasks (
         tenant_id,
         workflow_id,
         work_item_id,
         workspace_id,
         title,
         role,
         stage_name,
         priority,
         state,
         depends_on,
         input,
         context,
         role_config,
         environment,
         resource_bindings,
         activation_id,
         request_id,
         is_orchestrator_task,
         execution_backend,
         timeout_minutes,
         token_budget,
         cost_cap_usd,
         auto_retry,
         max_retries,
         max_iterations,
         llm_max_retries,
         metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'high', 'ready', '{}'::uuid[],
         $8, '{}'::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, true, 'runtime_only', $14, NULL, NULL, false, 0, $15, $16, $17::jsonb
       )
       ON CONFLICT (tenant_id, workflow_id, request_id)
       WHERE request_id IS NOT NULL
         AND workflow_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        activationAnchor.tenant_id,
        activationAnchor.workflow_id,
        taskDefinition.workItemId,
        workflow.workspace_id,
        taskDefinition.title,
        'orchestrator',
        taskDefinition.stageName,
        taskDefinition.input,
        taskDefinition.roleConfig,
        taskDefinition.environment,
        JSON.stringify(taskDefinition.resourceBindings),
        activationAnchor.id,
        taskRequestId,
        timeoutMinutes,
        loopContract.maxIterations,
        loopContract.llmMaxRetries,
        taskDefinition.metadata,
      ],
    );
    const createdTask = taskResult.rows[0] ?? null;
    const existingTask = createdTask
      ? null
      : await resolveExistingActivationTask(
        activationAnchor.tenant_id,
        activationAnchor.workflow_id,
        activationAnchor.id,
        taskRequestId,
        taskDefinition,
        loopContract,
        client,
      );
    const taskId = createdTask?.id ?? existingTask?.taskId ?? null;
    if (!taskId || (!createdTask && !existingTask)) {
      throw new Error('Failed to create orchestrator task');
    }

    if (existingTask?.kind === 'active' || existingTask?.kind === 'finalized') {
      logSafetynetTriggered(
        IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
        'idempotent activation task request returned existing orchestrator task',
        {
          workflow_id: activationAnchor.workflow_id,
          activation_id: activationAnchor.id,
          request_id: taskRequestId,
        },
      );
      if (ownsClient) {
        await client.query('COMMIT');
      }
      return taskId;
    }

    if (createdTask == null) {
      await deps.eventService.emit(
        {
          tenantId: activationAnchor.tenant_id,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: taskId,
          actorType: 'system',
          actorId: 'workflow_activation_dispatcher',
          data: {
            previous_state: existingTask?.previousState ?? null,
            state: 'ready',
            reason: 'activation_redispatched',
            activation_id: activationAnchor.id,
            is_orchestrator_task: true,
          },
        },
        client,
      );
    } else {
      await deps.eventService.emit(
        {
          tenantId: activationAnchor.tenant_id,
          type: 'task.created',
          entityType: 'task',
          entityId: taskId,
          actorType: 'system',
          actorId: 'workflow_activation_dispatcher',
          data: {
            workflow_id: activationAnchor.workflow_id,
            work_item_id: taskDefinition.workItemId,
            role: 'orchestrator',
            state: 'ready',
            activation_id: activationAnchor.id,
            is_orchestrator_task: true,
          },
        },
        client,
      );
    }

    await deps.eventService.emit(
      {
        tenantId: activationAnchor.tenant_id,
        type: 'workflow.activation_started',
        entityType: 'workflow',
        entityId: activationAnchor.workflow_id,
        actorType: 'system',
        actorId: 'workflow_activation_dispatcher',
        data: {
          activation_id: activationAnchor.id,
          event_type: primaryEvent.event_type,
          reason: activationReason,
          task_id: taskId,
          event_count: countDispatchableEvents(activationBatch),
        },
      },
      client,
    );

    if (ownsClient) {
      await client.query('COMMIT');
    }
    return taskId;
  } catch (error) {
    if (ownsClient) {
      await client.query('ROLLBACK');
    }
    if (isActiveActivationConstraintError(error)) {
      return null;
    }
    throw error;
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}
