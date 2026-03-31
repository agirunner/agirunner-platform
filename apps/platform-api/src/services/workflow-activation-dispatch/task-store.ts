import type { DatabaseClient } from '../../db/database.js';

import {
  TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
  TASK_LLM_MAX_RETRIES_RUNTIME_KEY,
  TASK_MAX_ITERATIONS_RUNTIME_KEY,
  readPositiveInteger,
  readRequiredPositiveIntegerRuntimeDefault,
} from '../runtime-defaults/runtime-default-values.js';

import type {
  ActivationTaskDefinition,
  ActivationTaskLoopContract,
  ActivationTaskStatus,
  ExistingActivationTaskResolution,
  ExistingActivationTaskRow,
  WorkflowDispatchRow,
} from './types.js';
import { asRecord, isActiveOrchestratorTaskState } from './helpers.js';

type FinalizeActivationForTask = (
  tenantId: string,
  task: Record<string, unknown>,
  status: ActivationTaskStatus,
  client: DatabaseClient,
) => Promise<void>;

export class ActivationTaskStore {
  async resolveExistingActivationTask(
    tenantId: string,
    workflowId: string,
    activationId: string,
    requestId: string,
    taskDefinition: ActivationTaskDefinition,
    loopContract: ActivationTaskLoopContract,
    client: DatabaseClient,
    finalizeActivationForTask: FinalizeActivationForTask,
  ): Promise<ExistingActivationTaskResolution | null> {
    const result = await client.query<ExistingActivationTaskRow>(
      `SELECT id,
              state,
              workflow_id,
              activation_id,
              is_orchestrator_task,
              title,
              metadata,
              output,
              error
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND request_id = $3
          AND is_orchestrator_task = true
        LIMIT 1`,
      [tenantId, workflowId, requestId],
    );
    const existingTask = result.rows[0] ?? null;
    if (!existingTask) {
      return null;
    }

    if (isActiveOrchestratorTaskState(existingTask.state)) {
      return { kind: 'active', taskId: existingTask.id };
    }

    if (existingTask.state === 'completed' || existingTask.state === 'escalated') {
      await finalizeActivationForTask(
        tenantId,
        { ...existingTask },
        existingTask.state === 'escalated' ? 'escalated' : 'completed',
        client,
      );
      return { kind: 'finalized', taskId: existingTask.id };
    }

    await this.reactivateExistingActivationTask(
      tenantId,
      existingTask.id,
      activationId,
      taskDefinition,
      loopContract,
      client,
    );
    return { kind: 'reactivated', taskId: existingTask.id, previousState: existingTask.state };
  }

  async reactivateExistingActivationTask(
    tenantId: string,
    taskId: string,
    activationId: string,
    taskDefinition: ActivationTaskDefinition,
    loopContract: ActivationTaskLoopContract,
    client: DatabaseClient,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE tasks
          SET state = 'ready',
              state_changed_at = now(),
              title = $3,
              stage_name = $4,
              work_item_id = $5,
              input = $6::jsonb,
              role_config = $7::jsonb,
              environment = $8::jsonb,
              resource_bindings = $9::jsonb,
              metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb,
              max_iterations = $11,
              llm_max_retries = $12,
              activation_id = $13::uuid,
              assigned_agent_id = NULL,
              assigned_worker_id = NULL,
              claimed_at = NULL,
              started_at = NULL,
              completed_at = NULL,
              output = NULL,
              error = NULL,
              metrics = NULL,
              git_info = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND is_orchestrator_task = true`,
      [
        tenantId,
        taskId,
        taskDefinition.title,
        taskDefinition.stageName,
        taskDefinition.workItemId,
        taskDefinition.input,
        taskDefinition.roleConfig,
        taskDefinition.environment,
        JSON.stringify(taskDefinition.resourceBindings),
        taskDefinition.metadata,
        loopContract.maxIterations,
        loopContract.llmMaxRetries,
        activationId,
      ],
    );
    if (!result.rowCount) {
      throw new Error('Failed to reactivate existing orchestrator task');
    }
  }

  async resolveDefaultTaskTimeoutMinutes(
    tenantId: string,
    client: DatabaseClient,
  ): Promise<number> {
    return readRequiredPositiveIntegerRuntimeDefault(
      client,
      tenantId,
      TASK_DEFAULT_TIMEOUT_MINUTES_RUNTIME_KEY,
    );
  }

  async resolveActivationTaskLoopContract(
    tenantId: string,
    workflow: WorkflowDispatchRow,
    client: DatabaseClient,
  ): Promise<ActivationTaskLoopContract> {
    const orchestrator = asRecord(asRecord(workflow.playbook_definition).orchestrator);
    const maxIterations = readPositiveInteger(orchestrator.max_iterations)
      ?? await readRequiredPositiveIntegerRuntimeDefault(
        client,
        tenantId,
        TASK_MAX_ITERATIONS_RUNTIME_KEY,
      );
    const llmMaxRetries = readPositiveInteger(orchestrator.llm_max_retries)
      ?? await readRequiredPositiveIntegerRuntimeDefault(
        client,
        tenantId,
        TASK_LLM_MAX_RETRIES_RUNTIME_KEY,
      );

    return {
      maxIterations,
      llmMaxRetries,
    };
  }
}
