export type WorkspaceArtifactExplorerSort =
  | 'newest'
  | 'oldest'
  | 'largest'
  | 'smallest'
  | 'name';

export interface WorkspaceArtifactExplorerListInput {
  q?: string;
  workflow_id?: string;
  work_item_id?: string;
  task_id?: string;
  stage_name?: string;
  role?: string;
  content_type?: string;
  preview_mode?: 'inline' | 'download';
  created_from?: string;
  created_to?: string;
  sort?: WorkspaceArtifactExplorerSort;
  page: number;
  per_page: number;
}

export interface WorkspaceArtifactExplorerRecord {
  id: string;
  workflow_id: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
  metadata: Record<string, unknown>;
  workflow_name: string;
  workflow_state: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
  stage_name: string | null;
  role: string | null;
  task_title: string;
  task_state: string;
  preview_eligible: boolean;
  preview_mode: 'text' | 'image' | 'pdf' | 'unsupported';
}

export interface WorkspaceArtifactSummary {
  total_artifacts: number;
  previewable_artifacts: number;
  total_bytes: number;
  workflow_count: number;
  work_item_count: number;
  task_count: number;
  role_count: number;
}

export interface WorkspaceArtifactWorkflowFilterOption {
  id: string;
  name: string;
}

export interface WorkspaceArtifactWorkItemFilterOption {
  id: string;
  title: string;
  workflow_id: string | null;
  stage_name: string | null;
}

export interface WorkspaceArtifactTaskFilterOption {
  id: string;
  title: string;
  workflow_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
}

export interface WorkspaceArtifactExplorerMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
  summary: WorkspaceArtifactSummary;
  filters: {
    workflows: WorkspaceArtifactWorkflowFilterOption[];
    work_items: WorkspaceArtifactWorkItemFilterOption[];
    tasks: WorkspaceArtifactTaskFilterOption[];
    stages: string[];
    roles: string[];
    content_types: string[];
  };
}

export interface WorkspaceArtifactExplorerListResult {
  data: WorkspaceArtifactExplorerRecord[];
  meta: WorkspaceArtifactExplorerMeta;
}

export interface WorkspaceArtifactExplorerRow {
  id: string;
  workflow_id: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number | string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  workflow_name: string;
  workflow_state: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
  stage_name: string | null;
  role: string | null;
  task_title: string;
  task_state: string;
}

export interface WorkspaceArtifactExplorerSummaryRow {
  total_artifacts: number | string | null;
  previewable_artifacts: number | string | null;
  total_bytes: number | string | null;
  workflow_count: number | string | null;
  work_item_count: number | string | null;
  task_count: number | string | null;
  role_count: number | string | null;
  workflows: unknown;
  work_items: unknown;
  tasks: unknown;
  stages: unknown;
  roles: unknown;
  content_types: unknown;
}

export interface SqlFilters {
  sql: string;
  values: unknown[];
}

export interface SqlFilterBuildOptions {
  firstFilterParameterIndex: number;
  previewMaxBytesIndex?: number;
}
