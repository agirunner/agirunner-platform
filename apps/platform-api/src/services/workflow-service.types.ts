import type { AppEnv } from '../config/schema.js';
import type { ArtifactStorageEnv } from '../content/storage-config.js';

export interface CreateWorkflowInput {
  playbook_id: string;
  project_id?: string;
  name: string;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  config_overrides?: Record<string, unknown>;
  instruction_config?: Record<string, unknown>;
}

export interface ListWorkflowQuery {
  project_id?: string;
  state?: string;
  playbook_id?: string;
  page: number;
  per_page: number;
}

export interface WorkflowWorkItemSummary {
  total_work_items: number;
  open_work_item_count: number;
  completed_work_item_count: number;
  active_stage_count: number;
  awaiting_gate_count: number;
  active_stage_names: string[];
}

export type WorkflowServiceConfig = Pick<AppEnv, 'TASK_DEFAULT_TIMEOUT_MINUTES'> &
  Partial<
    Pick<AppEnv, 'WORKFLOW_ACTIVATION_DELAY_MS' | 'WORKFLOW_ACTIVATION_STALE_AFTER_MS'>
  > &
  Partial<Pick<AppEnv, 'TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS'>> &
  ArtifactStorageEnv;
