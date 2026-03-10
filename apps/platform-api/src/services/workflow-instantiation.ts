import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../db/database.js';

import type { AppEnv } from '../config/schema.js';
import { NotFoundError, SchemaValidationFailedError } from '../errors/domain-errors.js';
import type { TemplateSchema, TemplateTaskDefinition } from '../orchestration/workflow-engine.js';
import { substituteTemplateVariables } from '../orchestration/template-variables.js';
import {
  buildStoredWorkflow,
  resolveWorkflowDependencies,
  type StoredWorkflowDefinition,
} from '../orchestration/workflow-model.js';
import { mergeLifecyclePolicy, type LifecyclePolicy } from './task-lifecycle-policy.js';

export function buildTemplateTaskIdMap(tasks: TemplateTaskDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of tasks) {
    map.set(task.id, randomUUID());
  }
  return map;
}

export function buildStoredWorkflowWorkflow(
  schema: TemplateSchema,
  taskIdMap: Map<string, string>,
): StoredWorkflowDefinition {
  const workflow = schema.workflow;
  if (!workflow) {
    throw new SchemaValidationFailedError('Template schema is missing workflow definition');
  }
  return buildStoredWorkflow(workflow, taskIdMap);
}

export async function loadTemplateOrThrow(
  tenantId: string,
  templateId: string,
  client: DatabaseClient,
) {
  const requestedTemplate = await client.query(
    `SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, templateId],
  );

  if (!requestedTemplate.rowCount) {
    throw new NotFoundError('Template not found');
  }

  const template = await client.query(
    `SELECT *
     FROM templates
     WHERE tenant_id = $1 AND slug = $2 AND deleted_at IS NULL
     ORDER BY version DESC, created_at DESC
     LIMIT 1`,
    [tenantId, requestedTemplate.rows[0].slug],
  );

  return template.rows[0];
}

type WorkflowInstantiationConfig = Pick<
  AppEnv,
  'TASK_DEFAULT_TIMEOUT_MINUTES' | 'TASK_DEFAULT_AUTO_RETRY' | 'TASK_DEFAULT_MAX_RETRIES'
>;

export async function insertTaskFromTemplate(params: {
  tenantId: string;
  workflowId: string;
  projectId?: string;
  task: TemplateTaskDefinition;
  parameters: Record<string, unknown>;
  taskIdMap: Map<string, string>;
  client: DatabaseClient;
  config: WorkflowInstantiationConfig;
  workflowLifecycle?: LifecyclePolicy;
  storedWorkflow: StoredWorkflowDefinition;
  dependencyMap: Map<string, string[]>;
}) {
  const { tenantId, workflowId, projectId, task, parameters, taskIdMap, client, config } = params;

  const taskId = taskIdMap.get(task.id);
  if (!taskId) {
    throw new SchemaValidationFailedError(
      `Template task '${task.id}' missing generated identifier`,
    );
  }

  const resolvedDependencies = resolveWorkflowDependencies(
    { phases: params.storedWorkflow.phases.map((phase) => ({
      name: phase.name,
      gate: phase.gate,
      parallel: phase.parallel,
      tasks: [...phase.task_refs],
    })) },
    params.dependencyMap,
  );
  const dependsOn = (resolvedDependencies.get(task.id) ?? []).map((dependencyTaskId) => {
    const mapped = taskIdMap.get(dependencyTaskId);
    if (!mapped) {
      throw new SchemaValidationFailedError(
        `Template task '${task.id}' depends on unknown task '${dependencyTaskId}'`,
      );
    }
    return mapped;
  });

  const phase = params.storedWorkflow.phases.find((candidate) => candidate.task_refs.includes(task.id));
  if (!phase) {
    throw new SchemaValidationFailedError(`Template task '${task.id}' is missing workflow phase`);
  }
  const isFirstPhase = params.storedWorkflow.phases[0]?.name === phase.name;
  const initialState =
    !isFirstPhase || dependsOn.length > 0
      ? 'pending'
      : task.requires_approval
        ? 'awaiting_approval'
        : 'ready';
  const title = substituteTemplateVariables(task.title_template, parameters);
  const input = substituteTemplateVariables(task.input_template ?? {}, parameters);
  const context = substituteTemplateVariables(task.context_template ?? {}, parameters);
  const roleConfig = task.role_config
    ? substituteTemplateVariables(task.role_config, parameters)
    : null;
  const environment = task.environment
    ? substituteTemplateVariables(task.environment, parameters)
    : null;
  const metadata = task.metadata ? substituteTemplateVariables(task.metadata, parameters) : {};
  const lifecyclePolicy = mergeLifecyclePolicy(params.workflowLifecycle, task.lifecycle);
  if (lifecyclePolicy) {
    metadata.lifecycle_policy = lifecyclePolicy;
  }
  if (task.output_state) {
    metadata.output_state = substituteTemplateVariables(task.output_state, parameters);
  }
  metadata.workflow_phase = phase.name;

  const created = await client.query(
    `INSERT INTO tasks (
      id, tenant_id, workflow_id, project_id, title, role, state, depends_on,
      requires_approval, input, context, capabilities_required, role_config, environment,
      timeout_minutes, auto_retry, max_retries, metadata
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
    ) RETURNING *`,
    [
      taskId,
      tenantId,
      workflowId,
      projectId ?? null,
      title,
      task.role ?? task.id,
      initialState,
      dependsOn,
      task.requires_approval ?? false,
      input,
      context,
      task.capabilities_required ?? [],
      roleConfig,
      environment,
      task.timeout_minutes ?? config.TASK_DEFAULT_TIMEOUT_MINUTES,
      task.auto_retry ?? config.TASK_DEFAULT_AUTO_RETRY,
      task.max_retries ?? config.TASK_DEFAULT_MAX_RETRIES,
      metadata,
    ],
  );

  return created.rows[0];
}
