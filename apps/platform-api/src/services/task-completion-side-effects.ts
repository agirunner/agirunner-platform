import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient } from '../db/database.js';
import type { TaskState } from '../orchestration/task-state-machine.js';
import { activateNextWorkflowPhase, readStoredWorkflow } from '../orchestration/workflow-runtime.js';
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

  if (!task.workflow_id) {
    return;
  }

  await advanceWorkflowWorkflow(eventService, identity, String(task.workflow_id), client);

  const contextKey = (task.role as string | null) || (task.type as string);
  await client.query(
    `UPDATE workflows
     SET context = jsonb_set(context, $2::text[], $3::jsonb, true),
         context_size_bytes = octet_length(jsonb_set(context, $2::text[], $3::jsonb, true)::text)
     WHERE tenant_id = $1
       AND id = $4
       AND octet_length(jsonb_set(context, $2::text[], $3::jsonb, true)::text) <= context_max_bytes`,
    [identity.tenantId, [contextKey], task.output ?? {}, task.workflow_id],
  );
}

async function advanceWorkflowWorkflow(
  eventService: EventService,
  identity: ApiKeyIdentity,
  workflowId: string,
  client: DatabaseClient,
) {
  const workflowResult = await client.query(
    'SELECT metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
    [identity.tenantId, workflowId],
  );
  const metadata = asRecord(workflowResult.rows[0]?.metadata);
  const workflow = readStoredWorkflow(metadata.workflow);
  if (!workflow) {
    return;
  }

  const tasksResult = await client.query(
    'SELECT id, state, depends_on, requires_approval, metadata FROM tasks WHERE tenant_id = $1 AND workflow_id = $2',
    [identity.tenantId, workflowId],
  );
  const tasks = tasksResult.rows.map((row) => row as Record<string, unknown>);

  for (let phaseIndex = 0; phaseIndex < workflow.phases.length; phaseIndex += 1) {
    const phase = workflow.phases[phaseIndex];
    const phaseTasks = tasks.filter((candidate) => phase.task_ids.includes(String(candidate.id)));
    const allCompleted = phaseTasks.length > 0 && phaseTasks.every((candidate) => candidate.state === 'completed');

    if (!allCompleted) {
      return;
    }

    await eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'phase.completed',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: 'system',
        actorId: 'workflow_resolver',
        data: {
          workflow_id: workflowId,
          phase_name: phase.name,
          timestamp: new Date().toISOString(),
        },
      },
      client,
    );

    const nextPhase = workflow.phases[phaseIndex + 1];
    if (!nextPhase) {
      return;
    }

    if (phase.gate === 'manual') {
      await eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'phase.gate.awaiting_approval',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: 'system',
          actorId: 'workflow_resolver',
          data: {
            workflow_id: workflowId,
            phase_name: phase.name,
            timestamp: new Date().toISOString(),
          },
        },
        client,
      );
      return;
    }

    const activation = await activateNextWorkflowPhase({
      tenantId: identity.tenantId,
      workflowId,
      workflow,
      currentPhaseName: phase.name,
      tasks,
      client,
    });

    if (activation.activated && activation.phaseName) {
      for (const nextTask of tasks.filter((candidate) => workflow.phases.find((item) => item.name === activation.phaseName)?.task_ids.includes(String(candidate.id)))) {
        if (nextTask.state !== 'ready' && nextTask.state !== 'awaiting_approval') {
          continue;
        }
        await eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'task.state_changed',
            entityType: 'task',
            entityId: String(nextTask.id),
            actorType: 'system',
            actorId: 'workflow_resolver',
            data: { from_state: 'pending', to_state: String(nextTask.state) },
          },
          client,
        );
      }
      await eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'phase.started',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: 'system',
          actorId: 'workflow_resolver',
          data: {
            workflow_id: workflowId,
            phase_name: activation.phaseName,
            timestamp: new Date().toISOString(),
          },
        },
        client,
      );
    }
    return;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
