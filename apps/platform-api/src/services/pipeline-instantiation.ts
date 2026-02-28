import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../db/database.js';

import type { AppEnv } from '../config/schema.js';
import { NotFoundError, SchemaValidationFailedError } from '../errors/domain-errors.js';
import type { TemplateTaskDefinition } from '../orchestration/pipeline-engine.js';
import { substituteTemplateVariables } from '../orchestration/template-variables.js';

export function buildTemplateTaskIdMap(tasks: TemplateTaskDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of tasks) {
    map.set(task.id, randomUUID());
  }
  return map;
}

export async function loadTemplateOrThrow(tenantId: string, templateId: string, client: DatabaseClient) {
  const requestedTemplate = await client.query(`SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [
    tenantId,
    templateId,
  ]);

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

type PipelineInstantiationConfig = Pick<
  AppEnv,
  'TASK_DEFAULT_TIMEOUT_MINUTES' | 'TASK_DEFAULT_AUTO_RETRY' | 'TASK_DEFAULT_MAX_RETRIES'
>;

export async function insertTaskFromTemplate(params: {
  tenantId: string;
  pipelineId: string;
  projectId?: string;
  task: TemplateTaskDefinition;
  parameters: Record<string, unknown>;
  taskIdMap: Map<string, string>;
  client: DatabaseClient;
  config: PipelineInstantiationConfig;
}) {
  const { tenantId, pipelineId, projectId, task, parameters, taskIdMap, client, config } = params;

  const taskId = taskIdMap.get(task.id);
  if (!taskId) {
    throw new SchemaValidationFailedError(`Template task '${task.id}' missing generated identifier`);
  }

  const dependsOn = (task.depends_on ?? []).map((dependencyTaskId) => {
    const mapped = taskIdMap.get(dependencyTaskId);
    if (!mapped) {
      throw new SchemaValidationFailedError(`Template task '${task.id}' depends on unknown task '${dependencyTaskId}'`);
    }
    return mapped;
  });

  const initialState = dependsOn.length > 0 ? 'pending' : task.requires_approval ? 'awaiting_approval' : 'ready';
  const title = substituteTemplateVariables(task.title_template, parameters);
  const input = substituteTemplateVariables(task.input_template ?? {}, parameters);
  const roleConfig = task.role_config ? substituteTemplateVariables(task.role_config, parameters) : null;
  const metadata = task.metadata ? substituteTemplateVariables(task.metadata, parameters) : {};

  const created = await client.query(
    `INSERT INTO tasks (
      id, tenant_id, pipeline_id, project_id, title, type, role, state, depends_on,
      requires_approval, input, capabilities_required, role_config, environment,
      timeout_minutes, auto_retry, max_retries, metadata
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10,$11,$12,$13,$14,$15,$16,$17,$18
    ) RETURNING *`,
    [
      taskId,
      tenantId,
      pipelineId,
      projectId ?? null,
      title,
      task.type,
      task.role ?? task.id,
      initialState,
      dependsOn,
      task.requires_approval ?? false,
      input,
      task.capabilities_required ?? [],
      roleConfig,
      task.environment ?? null,
      task.timeout_minutes ?? config.TASK_DEFAULT_TIMEOUT_MINUTES,
      task.auto_retry ?? config.TASK_DEFAULT_AUTO_RETRY,
      task.max_retries ?? config.TASK_DEFAULT_MAX_RETRIES,
      metadata,
    ],
  );

  return created.rows[0];
}
