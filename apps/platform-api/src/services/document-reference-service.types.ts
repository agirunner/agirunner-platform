export type DocumentSource = 'repository' | 'artifact' | 'external';

export interface WorkspaceSpecEnvelope {
  workspace_id: string;
  version: number;
  spec: Record<string, unknown>;
}

export interface ArtifactLookupRow {
  id: string;
  task_id: string;
  logical_path: string;
  content_type: string;
}

export interface WorkflowDocumentRow {
  id: string;
  logical_name: string;
  source: DocumentSource;
  location: string;
  artifact_id: string | null;
  content_type: string | null;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  task_id: string | null;
  created_at: Date;
}

export interface WorkflowScopeRow {
  workspace_id: string | null;
  workspace_spec_version: number | null;
}

export interface WorkspaceSpecRow {
  spec: Record<string, unknown>;
}

export interface ResolvedDocumentReference {
  logical_name: string;
  scope: 'workspace' | 'workflow';
  source: DocumentSource;
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
  source: DocumentSource;
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
  source?: DocumentSource;
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

export interface NormalizedDocumentDefinition {
  source: DocumentSource;
  title?: string;
  description?: string;
  metadata: Record<string, unknown>;
  repository?: string;
  path?: string;
  url?: string;
  artifact_id?: string;
  logical_path?: string;
}

export interface WorkflowDocumentApiShape {
  source: DocumentSource;
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

export interface WorkflowApiDocumentDefinition extends NormalizedDocumentDefinition {
  task_id?: string;
}
