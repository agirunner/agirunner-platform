import type { PlatformApiClient } from '@agirunner/sdk';
export interface DashboardApiOptions {
  baseUrl?: string;
  client?: PlatformApiClient;
  fetcher?: typeof fetch;
}

export interface NamedRecord {
  id: string;
  name?: string;
  title?: string;
  state?: string;
  status?: string;
}

export interface DashboardAgentRecord {
  id: string;
  worker_id?: string | null;
  name?: string | null;
  routing_tags?: string[] | null;
  status?: string | null;
  current_task_id?: string | null;
  heartbeat_interval_seconds?: number | null;
  last_heartbeat_at?: string | null;
  metadata?: Record<string, unknown> | null;
  registered_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DashboardSearchResult {
  type: 'workflow' | 'task' | 'worker' | 'agent' | 'workspace' | 'playbook';
  id: string;
  label: string;
  subtitle: string;
  href: string;
}

export interface DashboardPlaybookRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  outcome: string;
  lifecycle: 'planned' | 'ongoing';
  version: number;
  is_active?: boolean;
  definition: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardDeleteImpactSummary {
  workflows: number;
  active_workflows: number;
  tasks: number;
  active_tasks: number;
  work_items: number;
}

export interface DashboardPlaybookDeleteImpact {
  revision: DashboardDeleteImpactSummary;
  family: DashboardDeleteImpactSummary & { revisions: number };
}

export interface DashboardEventRecord {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id?: string | null;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface DashboardCursorPageMeta {
  has_more: boolean;
  next_after: string | null;
}

export interface DashboardEventPage {
  data: DashboardEventRecord[];
  meta: DashboardCursorPageMeta;
}

export interface DashboardApiKeyRecord {
  id: string;
  scope: string;
  owner_type: string;
  owner_id: string | null;
  label: string | null;
  key_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_revoked: boolean;
  revoked_at?: string | null;
  created_at: string;
}

export interface DashboardRoleModelOverride {
  provider: string;
  model: string;
  reasoning_config?: Record<string, unknown> | null;
}
