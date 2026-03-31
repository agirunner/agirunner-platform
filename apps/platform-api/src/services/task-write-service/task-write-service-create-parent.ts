import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { isOperatorScope } from '../../auth/scope.js';
import type { CreateTaskInput } from '../task/task-service.types.js';
import type { ParentTaskRow, TaskWriteDependencies } from './task-write-service.types.js';

const DEFAULT_MAX_SUBTASK_DEPTH = 3;
const DEFAULT_MAX_SUBTASKS_PER_PARENT = 20;

export class TaskWriteParentPolicies {
  constructor(private readonly deps: TaskWriteDependencies) {}

  private async applyParentTaskPolicies(identity: ApiKeyIdentity, input: CreateTaskInput) {
    const parentTask = await this.loadParentTask(identity.tenantId, input.parent_id as string);
    await this.assertSubtaskDepth(identity.tenantId, parentTask);
    await this.assertSubtaskCount(identity.tenantId, parentTask.id);
    await this.assertParentPermission(identity, parentTask);

    return {
      ...input,
      workflow_id: input.workflow_id ?? parentTask.workflow_id ?? undefined,
      workspace_id: input.workspace_id ?? parentTask.workspace_id ?? undefined,
    };
  }

  private async loadParentTask(tenantId: string, parentId: string): Promise<ParentTaskRow> {
    const result = await this.deps.pool.query<ParentTaskRow>(
      `SELECT id, workflow_id, workspace_id, assigned_agent_id, assigned_worker_id, metadata->>'parent_id' AS parent_id
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, parentId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Parent task not found');
    }
    return result.rows[0];
  }

  private async assertSubtaskDepth(tenantId: string, parentTask: ParentTaskRow) {
    const maxDepth = this.deps.config.TASK_MAX_SUBTASK_DEPTH ?? DEFAULT_MAX_SUBTASK_DEPTH;
    let depth = 1;
    let currentParentId = parentTask.parent_id;

    while (currentParentId) {
      depth += 1;
      if (depth >= maxDepth) {
        throw new ValidationError(`Sub-task depth limit of ${maxDepth} would be exceeded`);
      }

      const result = await this.deps.pool.query<{ parent_id: string | null }>(
        `SELECT metadata->>'parent_id' AS parent_id
           FROM tasks
          WHERE tenant_id = $1
            AND id = $2`,
        [tenantId, currentParentId],
      );
      if (!result.rowCount) {
        break;
      }
      currentParentId = result.rows[0].parent_id;
    }
  }

  private async assertSubtaskCount(tenantId: string, parentId: string) {
    const result = await this.deps.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM tasks
        WHERE tenant_id = $1
          AND metadata->>'parent_id' = $2`,
      [tenantId, parentId],
    );
    const count = Number(result.rows[0]?.total ?? '0');
    const maxSubtasks =
      this.deps.config.TASK_MAX_SUBTASKS_PER_PARENT ?? DEFAULT_MAX_SUBTASKS_PER_PARENT;
    if (count >= maxSubtasks) {
      throw new ValidationError(
        `Sub-task count limit of ${maxSubtasks} would be exceeded`,
      );
    }
  }

  private async assertParentPermission(identity: ApiKeyIdentity, parentTask: ParentTaskRow) {
    if (isOperatorScope(identity.scope)) {
      return;
    }

    if (identity.scope === 'agent' && identity.ownerId === parentTask.assigned_agent_id) {
      return;
    }

    if (identity.scope === 'worker' && identity.ownerId === parentTask.assigned_worker_id) {
      return;
    }

    if (
      identity.scope === 'agent' &&
      identity.ownerId &&
      parentTask.workflow_id &&
      (await this.deps.hasOrchestratorPermission(
        identity.tenantId,
        identity.ownerId,
        parentTask.workflow_id,
        this.deps.subtaskPermission,
      ))
    ) {
      return;
    }

    throw new ForbiddenError('Only the assigned parent owner or an active orchestrator grant can create sub-tasks');
  }

  private async resolveInitialState(
    tenantId: string,
    input: CreateTaskInput,
    hasUnfinishedDependencies: boolean,
  ) {
    if (hasUnfinishedDependencies) {
      return 'pending';
    }

    const shouldQueue = await this.deps.parallelismService.shouldQueueForCapacity(tenantId, {
      workflowId: input.workflow_id ?? null,
      workItemId: input.work_item_id ?? null,
      isOrchestratorTask: input.is_orchestrator_task ?? false,
      currentState: null,
    });
    if (shouldQueue) {
      return 'pending';
    }
    return 'ready';
  }

  private async hasUnfinishedDependencies(
    tenantId: string,
    dependencies: string[],
    db: DatabaseClient | DatabasePool,
  ): Promise<boolean> {
    if (dependencies.length === 0) {
      return false;
    }

    const unfinishedDeps = await db.query(
      "SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state <> 'completed' LIMIT 1",
      [tenantId, dependencies],
    );
    return (unfinishedDeps.rowCount ?? 0) > 0;
  }

}
