import type { DatabasePool } from '../../db/database.js';
import type { EventService } from '../event/event-service.js';
import type { PlaybookTaskParallelismService } from '../playbook/playbook-task-parallelism-service.js';
import type { TaskServiceConfig } from '../task/task-service.types.js';

export interface TaskWriteDependencies {
  pool: DatabasePool;
  eventService: EventService;
  config: TaskServiceConfig;
  hasOrchestratorPermission: (
    tenantId: string,
    agentId: string,
    workflowId: string,
    permission: string,
  ) => Promise<boolean>;
  subtaskPermission: string;
  loadTaskOrThrow: (tenantId: string, taskId: string) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  parallelismService: PlaybookTaskParallelismService;
}

export interface ParentTaskRow {
  id: string;
  workflow_id: string | null;
  workspace_id: string | null;
  assigned_agent_id: string | null;
  assigned_worker_id: string | null;
  parent_id: string | null;
}

export interface LinkedWorkItemRow {
  workflow_id: string;
  workflow_state: string;
  workflow_metadata: Record<string, unknown> | null;
  work_item_metadata: Record<string, unknown> | null;
  work_item_completed_at: string | null;
  parent_work_item_id: string | null;
  branch_id: string | null;
  branch_status: 'active' | 'completed' | 'blocked' | 'terminated' | null;
  stage_name: string;
  workflow_lifecycle: string | null;
  stage_status: string | null;
  stage_gate_status: string | null;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
}

export interface WorkflowMutationGuardRow {
  id: string;
  state: string;
  metadata: Record<string, unknown> | null;
}

export interface WorkflowPlaybookDefinitionRow {
  definition: unknown;
}
