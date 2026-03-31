import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { EventService } from '../event-service.js';
import type { WorkflowActivationDispatchService } from '../workflow-activation-dispatch-service.js';
import type { WorkflowActivationService } from '../workflow-activation/workflow-activation-service.js';
import type { WorkspaceMemoryScopeService } from '../workspace/memory/workspace-memory-scope-service.js';

export interface CreateWorkItemInput {
  request_id?: string;
  parent_work_item_id?: string;
  branch_key?: string;
  stage_name?: string;
  title: string;
  goal?: string;
  acceptance_criteria?: string;
  column_id?: string;
  owner_role?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateWorkItemOptions {
  dispatchActivation?: boolean;
}

export interface ListWorkflowWorkItemsInput {
  parent_work_item_id?: string;
  stage_name?: string;
  column_id?: string;
  grouped?: boolean;
}

export interface GetWorkflowWorkItemInput {
  include_children?: boolean;
}

export interface WorkItemReadModel extends Record<string, unknown> {
  id: string;
  workflow_id: string;
  parent_work_item_id: string | null;
  branch_id?: string | null;
  branch_status?: 'active' | 'completed' | 'blocked' | 'terminated' | null;
  stage_name: string | null;
  column_id: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  blocked_state?: 'blocked' | null;
  blocked_reason?: string | null;
  escalation_status?: 'open' | null;
  rework_count: number;
  latest_handoff_completion?: string | null;
  latest_handoff_resolution?: string | null;
  unresolved_findings?: string[];
  focus_areas?: string[];
  known_risks?: string[];
  current_subject_revision?: number | null;
  approved_assessment_count?: number;
  blocking_assessment_count?: number;
  pending_assessment_count?: number;
  assessment_status?: 'pending' | 'blocked' | 'approved' | null;
  gate_status?: string | null;
  gate_decision_feedback?: string | null;
  gate_decided_at?: string | Date | null;
  completed_at: string | Date | null;
  task_count: number;
  children_count: number;
  children_completed?: number;
  is_milestone: boolean;
}

export interface GroupedWorkItemReadModel extends WorkItemReadModel {
  children?: WorkItemReadModel[];
}

export interface WorkflowStageContextRow {
  id: string;
  lifecycle: string | null;
  state: string;
  metadata: Record<string, unknown> | null;
  active_stage_name: string | null;
  definition: unknown;
}

export interface CheckpointPredecessorRow {
  id: string;
  title: string;
  stage_name: string | null;
  column_id: string;
  completed_at: Date | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  blocked_state?: string | null;
  blocked_reason?: string | null;
  escalation_status?: string | null;
  gate_status: string;
  latest_handoff_completion: string | null;
  latest_handoff_resolution: string | null;
}

export interface NonTerminalTaskStateCountRow {
  state: string;
  count: number;
}

export interface ParentWorkItemBranchRow {
  branch_id: string | null;
  branch_status: 'active' | 'completed' | 'blocked' | 'terminated' | null;
}

export interface WorkItemServiceDependencies {
  pool: DatabasePool;
  eventService: EventService;
  activationService: WorkflowActivationService;
  activationDispatchService: WorkflowActivationDispatchService;
  memoryScopeService: WorkspaceMemoryScopeService;
}

export const WORK_ITEM_BASE_COLUMNS = [
  'id',
  'workflow_id',
  'parent_work_item_id',
  'branch_id',
  'request_id',
  'stage_name',
  'title',
  'goal',
  'acceptance_criteria',
  'column_id',
  'owner_role',
  'next_expected_actor',
  'next_expected_action',
  'blocked_state',
  'blocked_reason',
  'escalation_status',
  'rework_count',
  'priority',
  'notes',
  'created_by',
  'metadata',
  'completed_at',
  'created_at',
  'updated_at',
] as const;

export function workItemColumnList(tableAlias?: string) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return WORK_ITEM_BASE_COLUMNS.map((column) => `${prefix}${column}`).join(',\n              ');
}
