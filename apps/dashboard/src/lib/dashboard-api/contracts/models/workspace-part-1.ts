import type { DashboardWorkflowState, DashboardWorkflowRelations } from '../models.js';
export interface DashboardWorkspaceCredentialPosture {
  git_token?: string | null;
  git_token_configured?: boolean;
  git_ssh_private_key?: string | null;
  git_ssh_private_key_configured?: boolean;
  git_ssh_known_hosts?: string | null;
  git_ssh_known_hosts_configured?: boolean;
  webhook_secret?: string | null;
  webhook_secret_configured?: boolean;
}

export interface DashboardWorkspaceCredentialInput {
  git_token?: string | null;
  git_token_configured?: boolean;
  git_ssh_private_key?: string | null;
  git_ssh_private_key_configured?: boolean;
  git_ssh_known_hosts?: string | null;
  git_ssh_known_hosts_configured?: boolean;
  webhook_secret?: string | null;
  webhook_secret_configured?: boolean;
}

export type DashboardWorkspaceStorageType = 'git_remote' | 'host_directory' | 'workspace_artifacts';

export interface DashboardWorkspaceStorageRecord extends Record<string, unknown> {
  repository_url?: string | null;
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  host_path?: string | null;
  read_only?: boolean | null;
}

export type DashboardWorkspaceSettingsRecord = Record<string, unknown> & {
  workspace_storage_type?: DashboardWorkspaceStorageType | null;
  workspace_storage?: DashboardWorkspaceStorageRecord;
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  credentials?: DashboardWorkspaceCredentialPosture;
  workspace_brief?: string | null;
};

export type DashboardWorkspaceSettingsInput = Record<string, unknown> & {
  workspace_storage_type?: DashboardWorkspaceStorageType | null;
  workspace_storage?: DashboardWorkspaceStorageRecord;
  default_branch?: string | null;
  git_user_name?: string | null;
  git_user_email?: string | null;
  credentials?: DashboardWorkspaceCredentialInput;
  workspace_brief?: string | null;
};

export interface DashboardWorkspaceCreateInput {
  name: string;
  slug: string;
  description?: string;
  repository_url?: string;
  settings?: DashboardWorkspaceSettingsInput;
}

export interface DashboardWorkspacePatchInput {
  name?: string;
  slug?: string;
  description?: string;
  repository_url?: string;
  settings?: DashboardWorkspaceSettingsInput;
  is_active?: boolean;
}

export interface DashboardWorkspaceGitAccessVerifyInput {
  repository_url: string;
  default_branch?: string;
  git_token_mode: 'preserve' | 'replace' | 'clear';
  git_token?: string;
}

export interface DashboardWorkspaceGitAccessVerifyResult {
  ok: true;
  repository_url: string;
  default_branch: string | null;
  branch_verified: boolean;
}

export interface DashboardWorkspaceTimelineEntry {
  kind?: string;
  workflow_id: string;
  name: string;
  state: DashboardWorkflowState;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  task_counts?: Record<string, unknown>;
  stage_progression?: Array<Record<string, unknown>>;
  stage_metrics?: Array<Record<string, unknown>>;
  orchestrator_analytics?: Record<string, unknown>;
  produced_artifacts?: Array<Record<string, unknown>>;
  chain?: Record<string, unknown>;
  link?: string;
  workflow_relations?: DashboardWorkflowRelations;
}

export interface DashboardWorkspaceListSummary {
  active_workflow_count: number;
  completed_workflow_count: number;
  attention_workflow_count: number;
  total_workflow_count: number;
  last_workflow_activity_at: string | null;
}

export interface DashboardWorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  repository_url?: string | null;
  is_active?: boolean;
  memory?: Record<string, unknown>;
  settings?: DashboardWorkspaceSettingsRecord;
  summary?: DashboardWorkspaceListSummary;
  git_webhook_provider?: string | null;
  git_webhook_secret_configured?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardWorkspaceSpecRecord {
  workspace_id: string;
  version?: number;
  resources?: Record<string, unknown>;
  documents?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  config?: Record<string, unknown>;
  instructions?: Record<string, unknown>;
  updated_at?: string;
  created_at?: string | null;
  created_by_type?: string | null;
  created_by_id?: string | null;
}

export interface DashboardWorkspaceSpecEnvelope {
  workspace_id: string;
  version?: number;
  spec?: {
    resources?: Record<string, unknown>;
    documents?: Record<string, unknown>;
    tools?: Record<string, unknown>;
    config?: Record<string, unknown>;
    instructions?: Record<string, unknown>;
  };
  created_at?: string | null;
  created_by_type?: string | null;
  created_by_id?: string | null;
}

export function normalizeWorkspaceSpecRecord(
  envelope: DashboardWorkspaceSpecEnvelope,
): DashboardWorkspaceSpecRecord {
  return {
    workspace_id: envelope.workspace_id,
    version: envelope.version,
    config: envelope.spec?.config,
    instructions: envelope.spec?.instructions,
    resources: envelope.spec?.resources,
    documents: envelope.spec?.documents,
    tools: envelope.spec?.tools,
    created_at: envelope.created_at,
    created_by_type: envelope.created_by_type,
    created_by_id: envelope.created_by_id,
  };
}

export interface DashboardWorkspaceResourceRecord {
  id?: string;
  type?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DashboardWorkspaceToolCatalog {
  available?: unknown[];
  blocked?: unknown[];
  [key: string]: unknown;
}
