import type { TaskPriority, WorkflowState } from './common.js';

export interface WorkflowRelationRef {
  workflow_id: string;
  name?: string | null;
  state: WorkflowState;
  playbook_id?: string | null;
  playbook_name?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  is_terminal: boolean;
  link: string;
}

export interface WorkflowRelations {
  parent: WorkflowRelationRef | null;
  children: WorkflowRelationRef[];
  latest_child_workflow_id: string | null;
  child_status_counts: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
}

export interface ResolvedWorkflowConfig {
  workflow_id: string;
  resolved_config: Record<string, unknown>;
  config_layers?: Record<string, Record<string, unknown>>;
}

export interface ResolvedDocumentReference {
  logical_name: string;
  scope: 'workspace' | 'workflow';
  source: 'repository' | 'artifact' | 'external';
  title?: string;
  description?: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  task_id?: string;
  repository?: string;
  path?: string;
  url?: string;
  artifact?: {
    id: string;
    task_id: string;
    logical_path: string;
    content_type?: string;
    download_url: string;
  };
}

export interface CreateWorkflowDocumentInput {
  logical_name: string;
  source: 'repository' | 'artifact' | 'external';
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  repository?: string;
  path?: string;
  url?: string;
  task_id?: string;
  artifact_id?: string;
  logical_path?: string;
}

export interface UpdateWorkflowDocumentInput {
  source?: 'repository' | 'artifact' | 'external';
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  repository?: string | null;
  path?: string | null;
  url?: string | null;
  task_id?: string | null;
  artifact_id?: string | null;
  logical_path?: string | null;
}

interface WorkflowBase {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  playbook_id?: string | null;
  playbook_version?: number | null;
  name: string;
  state: WorkflowState;
  lifecycle?: 'planned' | 'ongoing' | null;
  parameters?: Record<string, unknown>;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  active_stages?: string[];
  work_item_summary?: {
    total_work_items: number;
    open_work_item_count: number;
    completed_work_item_count: number;
    active_stage_count: number;
    awaiting_gate_count: number;
    active_stage_names: string[];
  } | null;
  workflow_relations?: WorkflowRelations;
  workflow_stages?: WorkflowStage[];
  work_items?: WorkflowWorkItem[];
  activations?: WorkflowActivation[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type Workflow =
  | (WorkflowBase & {
      lifecycle: 'ongoing';
      current_stage?: never;
    })
  | (WorkflowBase & {
      lifecycle?: 'planned' | null;
      current_stage?: string | null;
    });

export interface WorkflowStage {
  id: string;
  workflow_id: string;
  name: string;
  position: number;
  goal: string;
  guidance?: string | null;
  status: string;
  is_active: boolean;
  gate_status: string;
  iteration_count: number;
  summary?: string | null;
  recommendation?: string | null;
  concerns?: string[];
  key_artifacts?: Array<Record<string, unknown>>;
  started_at?: string | null;
  completed_at?: string | null;
  open_work_item_count: number;
  total_work_item_count: number;
  updated_at?: string;
}

export interface WorkflowWorkItem {
  id: string;
  workflow_id: string;
  parent_work_item_id?: string | null;
  stage_name: string;
  title: string;
  goal?: string | null;
  acceptance_criteria?: string | null;
  column_id: string;
  owner_role?: string | null;
  priority: string;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  task_count?: number;
  children_count?: number;
  is_milestone?: boolean;
  children?: WorkflowWorkItem[];
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ListWorkflowWorkItemsQuery {
  parent_work_item_id?: string;
  stage_name?: string;
  column_id?: string;
  grouped?: boolean;
}

export interface GetWorkflowWorkItemQuery {
  include_children?: boolean;
}

export interface WorkflowActivation {
  id: string;
  workflow_id: string;
  activation_id?: string;
  request_id?: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown>;
  state: string;
  queued_at: string;
  started_at?: string | null;
  consumed_at?: string | null;
  completed_at?: string | null;
  summary?: string | null;
  error?: Record<string, unknown> | null;
  recovery_status?: string | null;
  recovery_reason?: string | null;
  recovery_detected_at?: string | null;
  stale_started_at?: string | null;
  redispatched_task_id?: string | null;
  latest_event_at?: string | null;
  event_count?: number;
  events?: Array<{
    id: string;
    activation_id?: string;
    request_id?: string | null;
    reason: string;
    event_type: string;
    payload: Record<string, unknown>;
    state: string;
    queued_at: string;
    started_at?: string | null;
    consumed_at?: string | null;
    completed_at?: string | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
  }>;
}

export interface WorkflowBoardColumn {
  id: string;
  name: string;
  title: string;
  description?: string | null;
  color?: string | null;
  limit?: number | null;
  position: number;
  is_blocked?: boolean;
  is_terminal?: boolean;
}

export interface WorkflowBoard {
  columns: WorkflowBoardColumn[];
  work_items: WorkflowWorkItem[];
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

export interface CreateWorkflowInput {
  playbook_id: string;
  name: string;
  workspace_id?: string;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  config_overrides?: Record<string, unknown>;
  instruction_config?: Record<string, unknown>;
}

export interface CreateWorkflowWorkItemInput {
  request_id?: string;
  parent_work_item_id?: string;
  stage_name?: string;
  title: string;
  goal?: string;
  acceptance_criteria?: string;
  column_id?: string;
  owner_role?: string;
  priority?: TaskPriority;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowWorkItemInput {
  parent_work_item_id?: string | null;
  title?: string;
  goal?: string;
  acceptance_criteria?: string;
  stage_name?: string;
  column_id?: string;
  owner_role?: string | null;
  priority?: TaskPriority;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}
