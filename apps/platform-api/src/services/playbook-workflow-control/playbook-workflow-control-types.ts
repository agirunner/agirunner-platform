
import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { EventService } from '../event/event-service.js';
import type { WorkflowDeliverableService } from '../workflow-deliverables/workflow-deliverable-service.js';
import type { WorkflowActivationDispatchService } from '../workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import type { WorkflowActivationService } from '../workflow-activation/workflow-activation-service.js';
import type { WorkflowStateService } from '../workflow-state-service.js';
import type { WorkflowStageGateRecord } from '../workflow-stage/workflow-stage-gate-service.js';
import type { CompletionCallouts } from '../guided-closure/types.js';

export interface WorkflowContextRow {
  id: string;
  workspace_id: string | null;
  playbook_id: string;
  lifecycle: string | null;
  active_stage_name: string | null;
  state: string;
  orchestration_state?: Record<string, unknown> | null;
  completion_callouts?: Record<string, unknown> | null;
  definition: unknown;
}

export interface WorkflowWorkItemRow {
  id: string;
  parent_work_item_id: string | null;
  stage_name: string;
  title: string;
  goal: string | null;
  acceptance_criteria: string | null;
  column_id: string;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  blocked_state?: string | null;
  blocked_reason?: string | null;
  escalation_status?: string | null;
  rework_count: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  notes: string | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
  completion_callouts: Record<string, unknown>;
  updated_at: Date;
}

export type WorkflowWorkItemResponse = Omit<WorkflowWorkItemRow, 'completed_at' | 'updated_at'> & {
  completed_at: string | null;
  updated_at: string;
};

export interface WorkflowStageRow {
  id: string;
  name: string;
  position: number;
  goal: string;
  guidance: string | null;
  status: string;
  gate_status: string;
  iteration_count: number;
  summary: string | null;
  metadata: Record<string, unknown>;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}

export interface WorkflowStageGateRow extends WorkflowStageGateRecord {
  id: string;
  workflow_id: string;
  stage_id: string;
  stage_name: string;
  status: string;
  request_summary: string | null;
  recommendation: string | null;
  concerns: unknown;
  key_artifacts: unknown;
  requested_at: Date;
  updated_at: Date;
  subject_revision?: number | null;
  decision_feedback: string | null;
  decided_at: Date | null;
  superseded_at?: Date | null;
  superseded_by_revision?: number | null;
  requested_by_work_item_id?: string | null;
}

export interface SubjectTaskChangeService {
  requestTaskChanges(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { feedback: string },
    client?: DatabaseClient,
  ): Promise<unknown>;
}

export interface BlockingStageWorkItemRow {
  id: string;
  title: string;
  blocking_resolution: string | null;
  blocked_state?: string | null;
  blocked_reason?: string | null;
  escalation_status?: string | null;
  next_expected_actor?: string | null;
  next_expected_action?: string | null;
  metadata?: Record<string, unknown>;
}

export const COMPLETION_BLOCKING_NEXT_ACTIONS = new Set(['assess', 'approve', 'rework', 'handoff']);
export const TERMINAL_TASK_STATES = ['completed', 'failed', 'cancelled'] as const;

export interface BlockingTaskRow {
  id: string;
  role: string;
  state: string;
  stage_name: string | null;
}

export interface UpdateWorkflowWorkItemInput {
  parent_work_item_id?: string | null;
  title?: string;
  goal?: string;
  acceptance_criteria?: string;
  stage_name?: string;
  column_id?: string;
  owner_role?: string | null;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CompleteWorkflowWorkItemInput {
  acting_task_id?: string | null;
  completion_callouts?: CompletionCallouts;
  waived_steps?: CompletionCallouts['waived_steps'];
  unresolved_advisory_items?: CompletionCallouts['unresolved_advisory_items'];
  completion_notes?: string | null;
}

export interface ResolveWorkflowWorkItemEscalationInput {
  action: 'dismiss' | 'unblock_subject' | 'reopen_subject';
  feedback?: string;
}

export interface StageGateRequestInput {
  summary: string;
  recommendation?: string;
  key_artifacts?: Array<{ id?: string; task_id?: string; label?: string; path?: string }>;
  concerns?: string[];
}

export interface StageGateDecisionInput {
  action: 'approve' | 'reject' | 'request_changes' | 'block';
  feedback?: string;
}

export interface AdvanceStageInput {
  to_stage_name?: string;
  summary?: string;
}

export interface CompleteWorkflowInput {
  summary: string;
  final_artifacts?: string[];
  completion_callouts?: CompletionCallouts;
  waived_steps?: CompletionCallouts['waived_steps'];
  unresolved_advisory_items?: CompletionCallouts['unresolved_advisory_items'];
  completion_notes?: string | null;
}

export interface NormalizedWorkItemUpdate {
  parent_work_item_id: string | null;
  title: string;
  goal: string | null;
  acceptance_criteria: string | null;
  stage_name: string;
  column_id: string;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  priority: 'critical' | 'high' | 'normal' | 'low';
  notes: string | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface Dependencies {
  pool: DatabasePool;
  eventService: EventService;
  stateService: WorkflowStateService;
  activationService: WorkflowActivationService;
  activationDispatchService: WorkflowActivationDispatchService;
  subjectTaskChangeService?: SubjectTaskChangeService;
  workflowDeliverableService?: Pick<WorkflowDeliverableService, 'reconcileWorkflowRollupsForCompletedWorkItem'>;
}
