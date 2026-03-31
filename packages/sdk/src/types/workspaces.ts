import type { WorkflowState } from './common.js';
import type { WorkflowRelations } from './workflows.js';

export interface Workspace {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  repository_url: string | null;
  settings: Record<string, unknown>;
  memory: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceTimelineEntry {
  kind?: string;
  workflow_id: string;
  name: string;
  state: WorkflowState;
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
  workflow_relations?: WorkflowRelations;
}
