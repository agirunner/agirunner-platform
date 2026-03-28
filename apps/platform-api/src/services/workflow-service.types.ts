import type { AppEnv } from '../config/schema.js';
import type { ArtifactStorageEnv } from '../content/storage-config.js';

export interface WorkflowBudgetInput {
  token_budget?: number;
  cost_cap_usd?: number;
  max_duration_minutes?: number;
}

export interface WorkflowBudgetSnapshot {
  tokens_used: number;
  tokens_limit: number | null;
  cost_usd: number;
  cost_limit_usd: number | null;
  elapsed_minutes: number;
  duration_limit_minutes: number | null;
  task_count: number;
  orchestrator_activations: number;
  tokens_remaining: number | null;
  cost_remaining_usd: number | null;
  time_remaining_minutes: number | null;
  warning_dimensions: string[];
  exceeded_dimensions: string[];
  warning_threshold_ratio: number;
}

export interface WorkflowAttemptInput {
  attempt_group_id?: string;
  root_workflow_id?: string;
  previous_attempt_workflow_id?: string;
  attempt_number?: number;
  attempt_kind?: string;
}

export interface CreateWorkflowInitialInputPacketInput {
  summary?: string;
  structured_inputs?: Record<string, unknown>;
  files?: Array<{
    fileName: string;
    description?: string;
    contentBase64: string;
    contentType?: string;
  }>;
}

export interface CreateWorkflowInput {
  playbook_id: string;
  workspace_id?: string;
  name: string;
  request_id?: string;
  operator_note?: string;
  initial_input_packet?: CreateWorkflowInitialInputPacketInput;
  redrive_reason?: string;
  redrive_input_packet_id?: string;
  inherited_input_packet_ids?: string[];
  inheritance_policy?: string;
  parameters?: Record<string, string>;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  attempt?: WorkflowAttemptInput;
  live_visibility_mode?: 'standard' | 'enhanced';
  config_overrides?: Record<string, unknown>;
  instruction_config?: Record<string, unknown>;
  budget?: WorkflowBudgetInput;
}

export interface ListWorkflowQuery {
  workspace_id?: string;
  state?: string;
  playbook_id?: string;
  page: number;
  per_page: number;
}

export interface WorkflowWorkItemSummary {
  total_work_items: number;
  open_work_item_count: number;
  blocked_work_item_count: number;
  completed_work_item_count: number;
  active_stage_count: number;
  awaiting_gate_count: number;
  active_stage_names: string[];
}

type LegacyTaskTimeoutConfig = {
  TASK_DEFAULT_TIMEOUT_MINUTES?: number;
};

export type WorkflowServiceConfig = LegacyTaskTimeoutConfig &
  Partial<
    Pick<
      AppEnv,
      'WORKFLOW_ACTIVATION_DELAY_MS' | 'WORKFLOW_ACTIVATION_STALE_AFTER_MS' | 'WORKFLOW_BUDGET_WARNING_RATIO'
    >
  > &
  Partial<
    Pick<
      AppEnv,
      'TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS' | 'WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES' | 'WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES'
    >
  > &
  ArtifactStorageEnv;
