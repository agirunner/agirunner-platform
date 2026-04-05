import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { LogService } from '../../logging/execution/log-service.js';
import type { EventService } from '../event/event-service.js';
import type { WorkflowTaskDeliverablePromotionService } from '../workflow-deliverables/workflow-task-deliverable-promotion-service.js';
import type { ImmediateWorkflowActivationDispatcher } from '../workflow-activation/workflow-immediate-activation.js';

export interface SubmitTaskHandoffInput {
  request_id?: string;
  task_rework_count?: number;
  summary: string;
  completion?: 'full' | 'blocked';
  completion_state?: 'full' | 'blocked';
  resolution?: 'approved' | 'request_changes' | 'rejected' | 'blocked';
  decision_state?: 'approved' | 'request_changes' | 'rejected' | 'blocked';
  closure_effect?: 'blocking' | 'advisory';
  changes?: unknown[];
  decisions?: unknown[];
  remaining_items?: unknown[];
  blockers?: unknown[];
  focus_areas?: string[];
  known_risks?: string[];
  recommended_next_actions?: unknown[];
  waived_steps?: unknown[];
  completion_callouts?: Record<string, unknown>;
  successor_context?: string;
  role_data?: Record<string, unknown>;
  subject_ref?: Record<string, unknown>;
  subject_revision?: number;
  outcome_action_applied?: 'reopen_subject' | 'route_to_role' | 'block_subject' | 'escalate' | 'terminate_branch';
  branch_id?: string;
  artifact_ids?: string[];
  documents?: Record<string, unknown>;
}

export type HandoffOutcomeAction =
  | 'reopen_subject'
  | 'route_to_role'
  | 'block_subject'
  | 'escalate'
  | 'terminate_branch';

export interface TaskContextRow {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  workspace_id: string | null;
  work_item_id: string | null;
  role: string | null;
  stage_name: string | null;
  state: string | null;
  rework_count: number | null;
  is_orchestrator_task: boolean;
  input: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface TaskHandoffRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string;
  task_rework_count: number;
  request_id: string | null;
  role: string;
  team_name: string | null;
  stage_name: string | null;
  sequence: number;
  summary: string;
  completion: string;
  completion_state?: string | null;
  resolution: string | null;
  decision_state?: string | null;
  closure_effect?: string | null;
  changes: unknown[];
  decisions: unknown[];
  remaining_items: unknown[];
  blockers: unknown[];
  focus_areas: string[];
  known_risks: string[];
  recommended_next_actions?: unknown[];
  waived_steps?: unknown[];
  completion_callouts?: Record<string, unknown>;
  successor_context: string | null;
  role_data: Record<string, unknown>;
  subject_ref?: Record<string, unknown> | null;
  subject_revision?: number | null;
  outcome_action_applied?: string | null;
  branch_id?: string | null;
  artifact_ids: string[];
  created_at: Date;
}

export type HandoffServiceDependencies = {
  pool: DatabasePool;
  logService?: LogService;
  eventService?: EventService;
  activationDispatchService?: ImmediateWorkflowActivationDispatcher;
  deliverablePromotionService?: Pick<WorkflowTaskDeliverablePromotionService, 'promoteFromHandoff'>;
};
