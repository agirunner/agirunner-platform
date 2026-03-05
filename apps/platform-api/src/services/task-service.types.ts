import type { AppEnv } from '../config/schema.js';

export interface CreateTaskInput {
  title: string;
  type: string;
  description?: string;
  priority?: string;
  pipeline_id?: string;
  project_id?: string;
  parent_id?: string;
  role?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  depends_on?: string[];
  requires_approval?: boolean;
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
}

export interface ListTaskQuery {
  state?: string;
  type?: string;
  project_id?: string;
  assigned_agent_id?: string;
  parent_id?: string;
  pipeline_id?: string;
  page: number;
  per_page: number;
}

export type TaskServiceConfig = Pick<
  AppEnv,
  'TASK_DEFAULT_TIMEOUT_MINUTES' | 'TASK_DEFAULT_AUTO_RETRY' | 'TASK_DEFAULT_MAX_RETRIES'
> & {
  TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS?: number;
};
