import type { DatabaseClient, DatabasePool } from '../../db/database.js';

import type { AppEnv } from '../../config/schema.js';
import type { EventService } from '../event/event-service.js';

export const ACTIVE_ORCHESTRATOR_TASK_STATES = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
] as const;

export const ACTIVE_SPECIALIST_HEARTBEAT_SKIP_STATES = [
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
] as const;

export const BLOCKED_ACTIVATION_RECOVERY_STATUS = 'operator_action_required';

export const IMMEDIATE_QUEUE_DISPATCH_EVENT_TYPES = [
  'workflow.created',
  'work_item.created',
  'task.escalated',
  'task.agent_escalated',
  'task.escalation_resolved',
  'task.completed',
  'task.failed',
  'task.output_pending_assessment',
  'task.approved',
  'task.assessment_requested_changes',
  'task.handoff_submitted',
  'child_workflow.completed',
  'child_workflow.failed',
  'child_workflow.cancelled',
] as const;

export const ACTIVATION_TASK_REQUEST_ID_PATTERN = /^activation:([^:]+):dispatch:(\d+)$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DEFAULT_REPOSITORY_TASK_TEMPLATE = 'execution-workspace';

export interface QueuedActivationRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  activation_id: string | null;
  request_id: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown>;
  state: string;
  dispatch_attempt: number;
  dispatch_token: string | null;
  queued_at: Date;
  started_at: Date | null;
  consumed_at: Date | null;
  completed_at: Date | null;
  summary: string | null;
  error: Record<string, unknown> | null;
}

export interface WorkflowDispatchRowBase {
  id: string;
  name: string;
  workspace_id: string | null;
  active_stages: string[];
  playbook_id: string;
  playbook_name: string;
  playbook_outcome: string | null;
  playbook_definition: Record<string, unknown> | null;
  workspace_repository_url: string | null;
  workspace_settings: Record<string, unknown> | null;
  workflow_git_branch: string | null;
  workflow_parameters: Record<string, unknown> | null;
}

export interface WorkflowDispatchSourceRow {
  id: string;
  name: string;
  workspace_id: string | null;
  lifecycle: string | null;
  playbook_id: string;
  playbook_name: string;
  playbook_outcome: string | null;
  playbook_definition: Record<string, unknown> | null;
  workspace_repository_url: string | null;
  workspace_settings: Record<string, unknown> | null;
  workflow_git_branch: string | null;
  workflow_parameters: Record<string, unknown> | null;
}

export type WorkflowDispatchRow =
  | (WorkflowDispatchRowBase & {
      lifecycle: 'ongoing';
      current_stage?: never;
    })
  | (WorkflowDispatchRowBase & {
      lifecycle?: string | null;
      current_stage: string | null;
    });

export interface ActivationTaskRow {
  id: string;
}

export interface ExistingActivationTaskRow extends ActivationTaskRow {
  state: string;
  workflow_id: string;
  activation_id: string | null;
  is_orchestrator_task: boolean;
  title: string;
  metadata: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

export interface ActivationTaskDefinition {
  title: string;
  stageName: string | null;
  workItemId: string | null;
  input: Record<string, unknown>;
  roleConfig: Record<string, unknown>;
  environment: Record<string, unknown>;
  resourceBindings: Record<string, unknown>[];
  metadata: Record<string, unknown>;
}

export interface ActivationTaskLoopContract {
  maxIterations: number;
  llmMaxRetries: number;
}

export interface ExistingActivationTaskResolution {
  kind: 'active' | 'reactivated' | 'finalized';
  taskId: string;
  previousState?: string;
}

export interface DispatchCandidateRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
}

export interface HeartbeatCandidateRow {
  tenant_id: string;
  workflow_id: string;
}

export interface RecoveryCandidateRow {
  id: string;
  tenant_id: string;
}

export interface StaleActivationStateRow extends QueuedActivationRow {
  active_task_id: string | null;
}

export interface DispatchOptions {
  ignoreDelay?: boolean;
}

export interface ActivationRecoveryResult {
  requeued: number;
  redispatched: number;
  reported: number;
  details: ActivationRecoveryDetail[];
}

export interface ActivationRecoveryDetail {
  activation_id: string;
  workflow_id: string;
  status: 'stale_detected' | 'requeued' | 'redispatched';
  reason: 'orchestrator_task_still_active' | 'missing_orchestrator_task';
  stale_started_at: string | null;
  detected_at: string;
  task_id?: string | null;
  redispatched_task_id?: string | null;
}

export interface DispatchDependencies {
  pool: DatabasePool;
  eventService: EventService;
  config: {
    TASK_DEFAULT_TIMEOUT_MINUTES?: number;
  } & Partial<
    Pick<
      AppEnv,
      | 'WORKFLOW_ACTIVATION_DELAY_MS'
      | 'WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS'
      | 'WORKFLOW_ACTIVATION_STALE_AFTER_MS'
    >
  >;
}

export type ActivationTaskStatus = 'completed' | 'failed' | 'escalated';
