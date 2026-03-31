import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import type { EventService } from '../event/event-service.js';
import type { PlaybookTaskParallelismService } from '../playbook-task-parallelism-service.js';
import type { TaskState } from '../../orchestration/task-state-machine.js';

export async function applyDependentTaskCompletionSideEffects(
  eventService: EventService,
  parallelismService: PlaybookTaskParallelismService | undefined,
  identity: ApiKeyIdentity,
  completedTaskId: string,
  client: DatabaseClient,
) {
  const dependents = await client.query(
    `SELECT id, workflow_id, work_item_id, state, is_orchestrator_task, depends_on FROM tasks
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

    const nextState: TaskState = (await shouldQueueDependentTask(
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
