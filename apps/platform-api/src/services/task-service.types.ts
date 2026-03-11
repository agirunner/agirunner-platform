import type { AppEnv } from '../config/schema.js';
import type { ArtifactStorageEnv } from '../content/storage-config.js';

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: string;
  workflow_id?: string;
  project_id?: string;
  parent_id?: string;
  role?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  depends_on?: string[];
  requires_approval?: boolean;
  requires_output_review?: boolean;
  review_prompt?: string;
  capabilities_required?: string[];
  role_config?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  resource_bindings?: unknown[];
  timeout_minutes?: number;
  token_budget?: number;
  cost_cap_usd?: number;
  auto_retry?: boolean;
  max_retries?: number;
  metadata?: Record<string, unknown>;
  retry_policy?: Record<string, unknown>;
}

export interface ListTaskQuery {
  state?: string;
  project_id?: string;
  assigned_agent_id?: string;
  parent_id?: string;
  workflow_id?: string;
  page: number;
  per_page: number;
}

export type TaskServiceConfig = Pick<
  AppEnv,
  | 'TASK_DEFAULT_TIMEOUT_MINUTES'
  | 'TASK_DEFAULT_AUTO_RETRY'
  | 'TASK_DEFAULT_MAX_RETRIES'
> &
  Partial<Pick<AppEnv, 'TASK_MAX_SUBTASK_DEPTH' | 'TASK_MAX_SUBTASKS_PER_PARENT'>> &
  Partial<Pick<AppEnv, 'ARTIFACT_ACCESS_URL_TTL_SECONDS'>> & {
    TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS?: number;
  } & ArtifactStorageEnv;
