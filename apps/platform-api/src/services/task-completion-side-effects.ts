import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient } from '../db/database.js';
import type { TaskState } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';

export async function applyTaskCompletionSideEffects(
  eventService: EventService,
  identity: ApiKeyIdentity,
  task: Record<string, unknown>,
  client: DatabaseClient,
) {
  const completedTaskId = task.id as string;
  const dependents = await client.query(
    `SELECT id, depends_on, requires_approval FROM tasks
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

    const nextState: TaskState = dependent.requires_approval ? 'awaiting_approval' : 'ready';
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

  if (!task.pipeline_id) {
    return;
  }

  const contextKey = (task.role as string | null) || (task.type as string);
  await client.query(
    `UPDATE pipelines
     SET context = jsonb_set(context, $2::text[], $3::jsonb, true),
         context_size_bytes = octet_length(jsonb_set(context, $2::text[], $3::jsonb, true)::text)
     WHERE tenant_id = $1
       AND id = $4
       AND octet_length(jsonb_set(context, $2::text[], $3::jsonb, true)::text) <= context_max_bytes`,
    [identity.tenantId, [contextKey], task.output ?? {}, task.pipeline_id],
  );
}
