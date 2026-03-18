import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { toStoredTaskState, type TaskState } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';

const ACTIVE_SPECIALIST_STATES: TaskState[] = [
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
];
const STORED_ACTIVE_SPECIALIST_STATES = ACTIVE_SPECIALIST_STATES.map(toStoredTaskState);

const priorityCase = "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";

interface CandidateTaskRow {
  id: string;
  work_item_id: string | null;
  state: TaskState;
  requires_approval: boolean;
}

interface ActiveTaskCountRow {
  work_item_id: string | null;
  total: string;
}

interface OrderedTaskRow {
  id: string;
  work_item_id: string | null;
  priority: 'low' | 'normal' | 'high' | 'critical';
  created_at: Date;
}

interface PlaybookWorkflowPolicy {
  maxActiveTasks: number | null;
  maxActiveTasksPerWorkItem: number | null;
  allowParallelWorkItems: boolean;
}

interface ReadyDecisionInput {
  taskId?: string;
  workflowId?: string | null;
  workItemId?: string | null;
  isOrchestratorTask?: boolean;
  currentState?: TaskState | null;
}

export class PlaybookTaskParallelismService {
  constructor(private readonly pool: DatabasePool) {}

  async shouldQueueForCapacity(
    tenantId: string,
    input: ReadyDecisionInput,
    client?: DatabaseClient,
  ): Promise<boolean> {
    if (!input.workflowId || input.isOrchestratorTask) {
      return false;
    }

    const db = client ?? this.pool;
    const policy = await this.loadPolicy(tenantId, input.workflowId, db);
    if (!policy) {
      return false;
    }

    const counts = await this.loadActiveCounts(tenantId, input.workflowId, db, input);
    const totalActive = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
    if (policy.maxActiveTasks && totalActive >= policy.maxActiveTasks) {
      return true;
    }

    const workItemKey = normalizeWorkItemKey(input.workItemId ?? null);
    if (
      policy.maxActiveTasksPerWorkItem &&
      counts.get(workItemKey)! >= policy.maxActiveTasksPerWorkItem
    ) {
      return true;
    }

    if (!policy.allowParallelWorkItems) {
      for (const [key, count] of counts.entries()) {
        if (count > 0 && key !== workItemKey) {
          return true;
        }
      }
    }

    return false;
  }

  async releaseQueuedReadyTasks(
    eventService: EventService,
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ): Promise<number> {
    const policy = await this.loadPolicy(tenantId, workflowId, client);
    if (!policy) {
      return 0;
    }

    const candidates = await client.query<CandidateTaskRow>(
      `SELECT t.id, t.work_item_id, t.state
              , t.requires_approval
         FROM tasks t
        WHERE t.tenant_id = $1
          AND t.workflow_id = $2
          AND t.state = 'pending'
          AND t.is_orchestrator_task = false
          AND NOT EXISTS (
            SELECT 1
              FROM tasks dep
             WHERE dep.tenant_id = t.tenant_id
               AND dep.id = ANY(t.depends_on)
               AND dep.state <> 'completed'
          )
        ORDER BY ${priorityCase} DESC, t.created_at ASC
        FOR UPDATE`,
      [tenantId, workflowId],
    );

    let promoted = 0;
    for (const candidate of candidates.rows) {
      const blocked = await this.shouldQueueForCapacity(
        tenantId,
        {
          taskId: candidate.id,
          workflowId,
          workItemId: candidate.work_item_id,
          currentState: candidate.state,
        },
        client,
      );
      if (blocked) {
        continue;
      }

      const nextState = candidate.requires_approval ? 'awaiting_approval' : 'ready';
      const updated = await client.query(
        `UPDATE tasks
            SET state = $3,
                state_changed_at = now()
          WHERE tenant_id = $1
            AND id = $2
            AND state = 'pending'`,
        [tenantId, candidate.id, toStoredTaskState(nextState)],
      );
      if (!updated.rowCount) {
        continue;
      }

      promoted += 1;
      await eventService.emit(
        {
          tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: candidate.id,
          actorType: 'system',
          actorId: 'playbook_parallelism',
          data: {
            from_state: 'pending',
            to_state: nextState,
            reason: 'parallelism_slot_available',
          },
        },
        client,
      );
    }

    return promoted;
  }

  async reclaimReadySlotForTask(
    eventService: EventService,
    tenantId: string,
    input: ReadyDecisionInput & { taskId: string; workflowId: string },
    client: DatabaseClient,
  ): Promise<boolean> {
    if (input.isOrchestratorTask) {
      return false;
    }

    const policy = await this.loadPolicy(tenantId, input.workflowId, client);
    if (!policy) {
      return false;
    }

    const retriedTask = await this.loadOrderedTask(tenantId, input.taskId, client);
    if (!retriedTask) {
      return false;
    }

    const counts = await this.loadActiveCounts(tenantId, input.workflowId, client, input);
    const readyCandidates = await client.query<OrderedTaskRow>(
      `SELECT id, work_item_id, priority, created_at
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND is_orchestrator_task = false
          AND state = 'ready'
          AND id <> $3::uuid
        ORDER BY ${priorityCase} ASC, created_at DESC
        FOR UPDATE`,
      [tenantId, input.workflowId, input.taskId],
    );

    for (const candidate of readyCandidates.rows) {
      if (!outranks(retriedTask, candidate)) {
        continue;
      }

      const simulatedCounts = new Map(counts);
      const candidateKey = normalizeWorkItemKey(candidate.work_item_id);
      simulatedCounts.set(candidateKey, Math.max(0, (simulatedCounts.get(candidateKey) ?? 0) - 1));
      if (!canSchedule(policy, simulatedCounts, input.workItemId ?? null)) {
        continue;
      }

      const updated = await client.query(
        `UPDATE tasks
            SET state = 'pending',
                state_changed_at = now()
          WHERE tenant_id = $1
            AND id = $2
            AND state = 'ready'`,
        [tenantId, candidate.id],
      );
      if (!updated.rowCount) {
        continue;
      }

      await eventService.emit(
        {
          tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: candidate.id,
          actorType: 'system',
          actorId: 'playbook_parallelism',
          data: {
            from_state: 'ready',
            to_state: 'pending',
            reason: 'parallelism_retry_fairness_requeue',
            reclaimed_by_task_id: input.taskId,
          },
        },
        client,
      );
      return true;
    }

    return false;
  }

  private async loadPolicy(
    tenantId: string,
    workflowId: string,
    db: DatabaseClient | DatabasePool,
  ): Promise<PlaybookWorkflowPolicy | null> {
    const result = await db.query<{ definition: Record<string, unknown> | null }>(
      `SELECT p.definition
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        FOR UPDATE OF w`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      return null;
    }

    const definition = parsePlaybookDefinition(result.rows[0].definition ?? {});
    return {
      maxActiveTasks: definition.orchestrator?.max_active_tasks ?? null,
      maxActiveTasksPerWorkItem: definition.orchestrator?.max_active_tasks_per_work_item ?? null,
      allowParallelWorkItems: definition.orchestrator?.allow_parallel_work_items ?? true,
    };
  }

  private async loadActiveCounts(
    tenantId: string,
    workflowId: string,
    db: DatabaseClient | DatabasePool,
    input: ReadyDecisionInput,
  ): Promise<Map<string, number>> {
    const excludeTaskId =
      input.taskId && input.currentState && ACTIVE_SPECIALIST_STATES.includes(input.currentState)
        ? input.taskId
        : null;
    const result = await db.query<ActiveTaskCountRow>(
      `SELECT work_item_id, COUNT(*)::text AS total
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND is_orchestrator_task = false
          AND state::text = ANY($3::text[])
          AND ($4::uuid IS NULL OR id <> $4::uuid)
        GROUP BY work_item_id`,
      [tenantId, workflowId, STORED_ACTIVE_SPECIALIST_STATES, excludeTaskId],
    );

    const counts = new Map<string, number>();
    counts.set(normalizeWorkItemKey(null), 0);
    counts.set(normalizeWorkItemKey(input.workItemId ?? null), 0);
    for (const row of result.rows) {
      counts.set(normalizeWorkItemKey(row.work_item_id), Number(row.total));
    }
    return counts;
  }

  private async loadOrderedTask(
    tenantId: string,
    taskId: string,
    db: DatabaseClient | DatabasePool,
  ): Promise<OrderedTaskRow | null> {
    const result = await db.query<OrderedTaskRow>(
      `SELECT id, work_item_id, priority, created_at
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, taskId],
    );
    return result.rows[0] ?? null;
  }
}

function normalizeWorkItemKey(value: string | null): string {
  return value ?? '__none__';
}

function canSchedule(
  policy: PlaybookWorkflowPolicy,
  counts: Map<string, number>,
  workItemId: string | null,
): boolean {
  const totalActive = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  if (policy.maxActiveTasks && totalActive >= policy.maxActiveTasks) {
    return false;
  }

  const workItemKey = normalizeWorkItemKey(workItemId);
  if (
    policy.maxActiveTasksPerWorkItem &&
    (counts.get(workItemKey) ?? 0) >= policy.maxActiveTasksPerWorkItem
  ) {
    return false;
  }

  if (!policy.allowParallelWorkItems) {
    for (const [key, count] of counts.entries()) {
      if (count > 0 && key !== workItemKey) {
        return false;
      }
    }
  }

  return true;
}

function outranks(left: OrderedTaskRow, right: OrderedTaskRow): boolean {
  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDelta !== 0) {
    return priorityDelta > 0;
  }

  const createdAtDelta = left.created_at.getTime() - right.created_at.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta < 0;
  }

  return left.id.localeCompare(right.id) < 0;
}

function priorityRank(priority: OrderedTaskRow['priority']): number {
  switch (priority) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'normal':
      return 2;
    default:
      return 1;
  }
}
