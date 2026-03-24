import type { AppEnv } from '../config/schema.js';
import type { ArtifactStorageEnv } from '../content/storage-config.js';

export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: 'analysis' | 'code' | 'assessment' | 'test' | 'docs' | 'orchestration' | 'custom';
  task_kind?: 'delivery' | 'assessment' | 'approval' | 'orchestrator';
  priority?: string;
  workflow_id?: string;
  work_item_id?: string;
  branch_id?: string;
  workspace_id?: string;
  stage_name?: string;
  activation_id?: string;
  request_id?: string;
  is_orchestrator_task?: boolean;
  parent_id?: string;
  role?: string;
  subject_task_id?: string;
  subject_work_item_id?: string;
  subject_handoff_id?: string;
  subject_revision?: number;
  credentials?: Record<string, string>;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  depends_on?: string[];
  assessment_prompt?: string;
  role_config?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  resource_bindings?: unknown[];
  timeout_minutes?: number;
  token_budget?: number;
  cost_cap_usd?: number;
  auto_retry?: boolean;
  max_retries?: number;
  max_iterations?: number;
  llm_max_retries?: number;
  metadata?: Record<string, unknown>;
  retry_policy?: Record<string, unknown>;
}

export interface ListTaskQuery {
  state?: string;
  workspace_id?: string;
  assigned_agent_id?: string;
  parent_id?: string;
  workflow_id?: string;
  work_item_id?: string;
  escalation_task_id?: string;
  stage_name?: string;
  activation_id?: string;
  is_orchestrator_task?: boolean;
  page: number;
  per_page: number;
}

export type PublicTaskState =
  | 'pending'
  | 'ready'
  | 'claimed'
  | 'in_progress'
  | 'awaiting_approval'
  | 'output_pending_assessment'
  | 'escalated'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AcceptedTaskStateFilter = PublicTaskState;

type LegacyTaskTimeoutConfig = {
  TASK_DEFAULT_TIMEOUT_MINUTES?: number;
};

export type TaskServiceConfig = LegacyTaskTimeoutConfig &
  Partial<
    Pick<
      AppEnv,
      | 'WORKFLOW_ACTIVATION_DELAY_MS'
      | 'WORKFLOW_ACTIVATION_STALE_AFTER_MS'
      | 'WEBHOOK_ENCRYPTION_KEY'
      | 'WORKFLOW_BUDGET_WARNING_RATIO'
    >
  > &
  Partial<Pick<AppEnv, 'TASK_MAX_SUBTASK_DEPTH' | 'TASK_MAX_SUBTASKS_PER_PARENT'>> &
  Partial<Pick<AppEnv, 'ARTIFACT_ACCESS_URL_TTL_SECONDS'>> & {
    TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS?: number;
  } & ArtifactStorageEnv;
