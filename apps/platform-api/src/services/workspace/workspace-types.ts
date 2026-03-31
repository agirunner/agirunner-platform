import type { TenantRow } from '../../db/tenant-scoped-repository.js';
import type { WorkspaceMemoryMutationContext } from './memory/workspace-memory-scope-service.js';

export interface WorkspaceListQuery {
  page: number;
  per_page: number;
  q?: string;
  is_active?: boolean;
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description?: string;
  repository_url?: string;
  settings?: Record<string, unknown>;
  memory?: Record<string, unknown>;
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  description?: string;
  repository_url?: string;
  settings?: Record<string, unknown>;
  is_active?: boolean;
}

export interface VerifyWorkspaceGitAccessInput {
  repository_url: string;
  default_branch?: string;
  git_token_mode: 'preserve' | 'replace' | 'clear';
  git_token?: string;
}

export interface WorkspaceMemoryPatch {
  key: string;
  value?: unknown;
  context?: WorkspaceMemoryMutationContext;
}

export interface WorkspaceListSummary {
  active_workflow_count: number;
  completed_workflow_count: number;
  attention_workflow_count: number;
  total_workflow_count: number;
  last_workflow_activity_at: string | null;
}

export interface WorkspaceWorkflowSummaryRow {
  workspace_id: string;
  active_workflow_count: number;
  completed_workflow_count: number;
  attention_workflow_count: number;
  total_workflow_count: number;
  last_workflow_activity_at: string | null;
}

export type WorkspaceRow = TenantRow & Record<string, unknown>;

export type GitWebhookProvider = 'github' | 'gitea' | 'gitlab';

export interface GitWebhookConfig {
  provider: GitWebhookProvider;
  secret: string;
}
