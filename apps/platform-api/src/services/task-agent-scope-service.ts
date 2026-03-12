import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ForbiddenError } from '../errors/domain-errors.js';
import { normalizeTaskState } from '../orchestration/task-state-machine.js';

export interface ActiveTaskScope {
  id: string;
  workflow_id: string | null;
  project_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  activation_id: string | null;
  assigned_agent_id: string | null;
  is_orchestrator_task: boolean;
  state: string;
}

export interface ActiveOrchestratorTaskScope extends ActiveTaskScope {
  workflow_id: string;
}

export class TaskAgentScopeService {
  constructor(private readonly pool: DatabasePool) {}

  async loadAgentOwnedActiveTask(identity: ApiKeyIdentity, taskId: string): Promise<ActiveTaskScope> {
    if (!identity.ownerId) {
      throw new ForbiddenError('Agent identity is not bound to an agent record');
    }

    const result = await this.pool.query<ActiveTaskScope>(
      `SELECT id, workflow_id, project_id, work_item_id, stage_name, activation_id, assigned_agent_id, is_orchestrator_task, state
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, taskId],
    );
    const task = result.rows[0];
    if (!task) {
      throw new ForbiddenError('Task is not available to the calling agent');
    }
    if (task.assigned_agent_id !== identity.ownerId) {
      throw new ForbiddenError('Task is not owned by the calling agent');
    }
    const normalizedState = normalizeTaskState(task.state) ?? task.state;
    if (!['claimed', 'in_progress', 'output_pending_review', 'awaiting_approval'].includes(normalizedState)) {
      throw new ForbiddenError('Task-scoped tools require an active task');
    }
    task.state = normalizedState;
    return task;
  }

  async loadAgentOwnedOrchestratorTask(identity: ApiKeyIdentity, taskId: string): Promise<ActiveOrchestratorTaskScope> {
    const task = await this.loadAgentOwnedActiveTask(identity, taskId);
    if (!task.is_orchestrator_task || !task.workflow_id) {
      throw new ForbiddenError('Task is not available for orchestrator control');
    }
    return task as ActiveOrchestratorTaskScope;
  }
}
