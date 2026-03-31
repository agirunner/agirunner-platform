import type { Task } from '@agirunner/sdk';
import type {
  DashboardWorkflowState,
  DashboardExecutionEnvironmentRecord,
  DashboardWorkflowActivationRecord,
  DashboardWorkflowBoardColumn,
  DashboardWorkflowStageRecord,
  DashboardCompletionCallouts,
  DashboardWorkflowWorkItemRecord,
} from '../models.js';
export interface DashboardTaskHandoffRecord {
  id: string;
  workflow_id: string;
  work_item_id?: string | null;
  task_id: string;
  request_id?: string | null;
  role: string;
  team_name?: string | null;
  stage_name?: string | null;
  sequence: number;
  summary: string;
  completion: string;
  closure_effect?: 'blocking' | 'advisory' | null;
  completion_callouts?: DashboardCompletionCallouts | null;
  changes: unknown[];
  decisions: unknown[];
  remaining_items: unknown[];
  blockers: unknown[];
  focus_areas: string[];
  known_risks: string[];
  successor_context?: string | null;
  role_data: Record<string, unknown>;
  artifact_ids: string[];
  created_at: string;
}

export interface DashboardWorkItemMemoryEntry {
  key: string;
  value: unknown;
  event_id: number;
  updated_at: string;
  actor_type: string;
  actor_id: string | null;
  workflow_id: string | null;
  work_item_id: string | null;
  task_id: string | null;
  stage_name: string | null;
}

export interface DashboardWorkItemMemoryHistoryEntry extends DashboardWorkItemMemoryEntry {
  event_type: 'updated' | 'deleted';
}

export interface DashboardWorkflowBoardResponse {
  columns: DashboardWorkflowBoardColumn[];
  work_items: DashboardWorkflowWorkItemRecord[];
  active_stages: string[];
  awaiting_gate_count: number;
  stage_summary: Array<{
    name: string;
    goal: string;
    status: string;
    is_active: boolean;
    gate_status: string;
    work_item_count: number;
    open_work_item_count: number;
    completed_count: number;
  }>;
}

export interface DashboardWorkflowRelationRef {
  workflow_id: string;
  name?: string | null;
  state: DashboardWorkflowState;
  playbook_id?: string | null;
  playbook_name?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  is_terminal: boolean;
  link: string;
}

export interface DashboardWorkflowRelations {
  parent: DashboardWorkflowRelationRef | null;
  children: DashboardWorkflowRelationRef[];
  latest_child_workflow_id: string | null;
  child_status_counts: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
}

export interface DashboardWorkflowRecordBase {
  id: string;
  name: string;
  state: DashboardWorkflowState;
  created_at: string;
  workspace_id?: string | null;
  workspace_name?: string | null;
  playbook_id?: string | null;
  playbook_name?: string | null;
  lifecycle?: 'planned' | 'ongoing' | null;
  active_stages?: string[];
  work_item_summary?: {
    total_work_items: number;
    open_work_item_count: number;
    blocked_work_item_count?: number;
    completed_work_item_count: number;
    active_stage_count: number;
    awaiting_gate_count: number;
    active_stage_names: string[];
  } | null;
  task_counts?: Record<string, number>;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  completion_callouts?: DashboardCompletionCallouts | null;
  workflow_relations?: DashboardWorkflowRelations | null;
  workflow_stages?: DashboardWorkflowStageRecord[];
  work_items?: DashboardWorkflowWorkItemRecord[];
  activations?: DashboardWorkflowActivationRecord[];
}

export type DashboardWorkflowRecord =
  | (DashboardWorkflowRecordBase & {
      lifecycle: 'ongoing';
      current_stage?: never;
    })
  | (DashboardWorkflowRecordBase & {
      lifecycle?: 'planned' | null;
      current_stage?: string | null;
    });

export interface DashboardTaskWorkflowRef {
  id: string;
  name?: string | null;
  workspace_id?: string | null;
}

export interface DashboardTaskRecord extends Task {
  workflow?: DashboardTaskWorkflowRef | null;
  workflow_name?: string | null;
  workspace_name?: string | null;
  work_item_id?: string | null;
  work_item_title?: string | null;
  stage_name?: string | null;
  activation_id?: string | null;
  execution_backend: 'runtime_only' | 'runtime_plus_task';
  execution_environment?: DashboardExecutionEnvironmentRecord | null;
  used_task_sandbox: boolean;
}

export interface DashboardPlatformInstructionRecord {
  tenant_id?: string;
  version: number;
  content: string;
  format?: string;
  updated_at?: string | null;
  updated_by_type?: string | null;
  updated_by_id?: string | null;
}

export interface DashboardPlatformInstructionVersionRecord {
  id: string;
  tenant_id?: string;
  version: number;
  content: string;
  format?: string;
  created_at?: string | null;
  created_by_type?: string | null;
  created_by_id?: string | null;
}

export interface DashboardCostSummaryRecord {
  today: number;
  this_week: number;
  this_month: number;
  budget_total: number;
  budget_remaining: number;
  by_workflow: Array<{ name: string; cost: number }>;
  by_model: Array<{ model: string; cost: number }>;
  daily_trend: Array<{ date: string; cost: number }>;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostUsd: number;
  totalWallTimeMs: number;
  eventCount: number;
}

export interface DashboardGovernanceRetentionPolicy {
  task_prune_after_days: number;
  workflow_delete_after_days: number;
  execution_log_retention_days: number;
}

export interface DashboardLoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
}
