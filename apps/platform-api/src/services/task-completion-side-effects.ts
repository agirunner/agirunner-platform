import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient } from '../db/database.js';
import type { TaskState } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { enqueueWorkflowActivationRecord } from './workflow-activation-record.js';

export function validateOutputSchema(output: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== 'object') {
    return errors;
  }

  const requiredFields = schema.required as string[] | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;

  if (!output || typeof output !== 'object') {
    errors.push('Output must be an object');
    return errors;
  }

  const outputRecord = output as Record<string, unknown>;

  if (requiredFields) {
    for (const field of requiredFields) {
      if (!(field in outputRecord)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in outputRecord && propSchema.type) {
        const value = outputRecord[key];
        const expectedType = propSchema.type as string;
        if (expectedType === 'string' && typeof value !== 'string') {
          errors.push(`Field ${key} must be a string`);
        } else if (expectedType === 'number' && typeof value !== 'number') {
          errors.push(`Field ${key} must be a number`);
        } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Field ${key} must be a boolean`);
        } else if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Field ${key} must be an array`);
        } else if (expectedType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
          errors.push(`Field ${key} must be an object`);
        }
      }
    }
  }

  return errors;
}

export async function applyTaskCompletionSideEffects(
  eventService: EventService,
  parallelismService: PlaybookTaskParallelismService | undefined,
  identity: ApiKeyIdentity,
  task: Record<string, unknown>,
  client: DatabaseClient,
) {
  const outputSchema = asRecord((task.metadata as Record<string, unknown> | null)?.output_schema);
  if (Object.keys(outputSchema).length > 0 && task.output) {
    const validationErrors = validateOutputSchema(task.output, outputSchema);
    if (validationErrors.length > 0) {
      await eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.output_validation_failed',
          entityType: 'task',
          entityId: task.id as string,
          actorType: 'system',
          actorId: 'schema_validator',
          data: { errors: validationErrors },
        },
        client,
      );
    }
  }

  const completedTaskId = task.id as string;
  const dependents = await client.query(
    `SELECT id, workflow_id, work_item_id, state, is_orchestrator_task, depends_on, requires_approval FROM tasks
     WHERE tenant_id = $1 AND state = 'pending' AND $2 = ANY(depends_on)`,
    [identity.tenantId, completedTaskId],
  );

  for (const dependent of dependents.rows) {
    const unfinishedDeps = await client.query(
      "SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state <> 'completed' LIMIT 1",
      [identity.tenantId, dependent.depends_on],
    );
    if (unfinishedDeps.rowCount) {
      continue;
    }

    const nextState: TaskState = dependent.requires_approval
      ? 'awaiting_approval'
      : (await shouldQueueDependentTask(
          parallelismService,
          identity.tenantId,
          dependent as Record<string, unknown>,
          client,
        ))
          ? 'pending'
          : 'ready';
    await client.query('UPDATE tasks SET state = $3, state_changed_at = now() WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      dependent.id,
      nextState,
    ]);

    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'task.state_changed',
        entityType: 'task',
        entityId: dependent.id as string,
        actorType: 'system',
        actorId: 'dependency_resolver',
        data: { from_state: 'pending', to_state: nextState },
      },
      client,
    );
  }

  if (!task.workflow_id) {
    return;
  }

  if (task.is_orchestrator_task) {
    return;
  }

  const workflowResult = await client.query(
    'SELECT playbook_id FROM workflows WHERE tenant_id = $1 AND id = $2',
    [identity.tenantId, task.workflow_id],
  );
  if (workflowResult.rows[0]?.playbook_id) {
    await enqueueWorkflowActivationRecord(client, eventService, {
      tenantId: identity.tenantId,
      workflowId: String(task.workflow_id),
      requestId: `task-completed:${task.id}:${String(task.updated_at ?? task.completed_at ?? '')}`,
      reason: 'task.completed',
      eventType: 'task.completed',
      payload: {
        task_id: task.id,
        task_role: task.role ?? null,
        task_title: task.title ?? null,
        work_item_id: task.work_item_id ?? null,
        stage_name: task.stage_name ?? null,
      },
      actorType: 'system',
      actorId: 'task_completion_side_effects',
    });
    return;
  }
}

async function shouldQueueDependentTask(
  parallelismService: PlaybookTaskParallelismService | undefined,
  tenantId: string,
  dependent: Record<string, unknown>,
  client: DatabaseClient,
) {
  if (!parallelismService) {
    return false;
  }
  return parallelismService.shouldQueueForCapacity(
    tenantId,
    {
      taskId: String(dependent.id),
      workflowId: (dependent.workflow_id as string | null | undefined) ?? null,
      workItemId: (dependent.work_item_id as string | null | undefined) ?? null,
      isOrchestratorTask: Boolean(dependent.is_orchestrator_task),
      currentState: dependent.state as TaskState,
    },
    client,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
