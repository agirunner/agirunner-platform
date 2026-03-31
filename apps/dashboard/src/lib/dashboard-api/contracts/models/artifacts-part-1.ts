export interface DashboardWorkspaceArtifactFileRecord {
  id: string;
  workspace_id: string;
  key: string;
  description?: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export interface DashboardWorkspaceArtifactFileUploadInput {
  key?: string;
  description?: string;
  file_name: string;
  content_base64: string;
  content_type?: string;
}

export interface DashboardMissionControlArtifactLocation {
  kind: 'artifact';
  artifactId: string;
  taskId: string;
  logicalPath: string;
  previewPath: string | null;
  downloadPath: string;
  contentType: string | null;
}

export interface DashboardResolvedDocumentReference {
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

export interface DashboardWorkflowDocumentCreateInput {
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

export interface DashboardWorkflowDocumentUpdateInput {
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

export interface DashboardTaskArtifactRecord {
  id: string;
  workflow_id?: string | null;
  workspace_id?: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  metadata: Record<string, unknown>;
  retention_policy: Record<string, unknown>;
  expires_at?: string | null;
  created_at: string;
  download_url: string;
  access_url?: string | null;
  access_url_expires_at?: string | null;
  storage_backend?: string;
}

export interface DashboardWorkspaceArtifactRecord {
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

export interface DashboardWorkspaceArtifactSummary {
  total_artifacts: number;
  previewable_artifacts: number;
  total_bytes: number;
  workflow_count: number;
  work_item_count: number;
  task_count: number;
  role_count: number;
}

export interface DashboardWorkspaceArtifactWorkflowOption {
  id: string;
  name: string;
}

export interface DashboardWorkspaceArtifactWorkItemOption {
  id: string;
  title: string;
  workflow_id: string | null;
  stage_name: string | null;
}

export interface DashboardWorkspaceArtifactTaskOption {
  id: string;
  title: string;
  workflow_id: string | null;
  work_item_id: string | null;
  stage_name: string | null;
}

export interface DashboardWorkspaceArtifactResponse {
  data: DashboardWorkspaceArtifactRecord[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_more: boolean;
    summary: DashboardWorkspaceArtifactSummary;
    filters: {
      workflows: DashboardWorkspaceArtifactWorkflowOption[];
      work_items: DashboardWorkspaceArtifactWorkItemOption[];
      tasks: DashboardWorkspaceArtifactTaskOption[];
      stages: string[];
      roles: string[];
      content_types: string[];
    };
  };
}

export interface DashboardTaskArtifactContent {
  content_type: string;
  content_text: string;
  file_name?: string | null;
  size_bytes: number;
}

export interface DashboardTaskArtifactDownload {
  blob: Blob;
  content_type: string;
  file_name?: string | null;
  size_bytes: number;
}

export interface DashboardWorkspaceArtifactFileDownload {
  blob: Blob;
  content_type: string;
  file_name?: string | null;
  size_bytes: number;
}

export interface DashboardTaskArtifactUploadInput {
  path: string;
  content_base64: string;
  content_type?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardCustomizationManagedFile {
  source: string;
  target: string;
}

export interface DashboardCustomizationSetupScript {
  path: string;
  sha256: string;
}

export interface DashboardCustomizationReasoning {
  orchestrator_level?: 'low' | 'medium' | 'high';
  internal_workers_level?: 'low' | 'medium' | 'high';
}

export interface DashboardCustomizationManifest {
  template: string;
  base_image: string;
  customizations?: {
    apt?: string[];
    npm_global?: string[];
    pip?: string[];
    files?: DashboardCustomizationManagedFile[];
    setup_script?: DashboardCustomizationSetupScript;
  };
  reasoning?: DashboardCustomizationReasoning;
}

export interface DashboardCustomizationValidationError {
  field_path: string;
  rule_id: string;
  message: string;
  remediation: string;
}

export interface DashboardCustomizationValidateResponse {
  valid: boolean;
  manifest: DashboardCustomizationManifest;
  errors?: DashboardCustomizationValidationError[];
}

export interface DashboardCustomizationGate {
  name: string;
  status: string;
  message?: string;
}

export interface DashboardCustomizationWaiver {
  gate: string;
  scope?: string;
  environment?: string;
  reason?: string;
  ticket?: string;
  approved_by?: string[];
  expires_at?: string;
}

export interface DashboardCustomizationBuildInputs {
  template_version?: string;
  policy_bundle_version?: string;
  lock_digests?: Record<string, string>;
  build_args?: Record<string, string>;
  secret_refs?: Array<{ id: string; version: string }>;
}

export interface DashboardCustomizationTrustPolicy {
  environment?: string;
}

export interface DashboardCustomizationTrustEvidence {
  vulnerability?: {
    critical_findings?: number;
    high_findings?: number;
  };
  sbom?: {
    format?: string;
    digest?: string;
  };
  provenance?: {
    verified?: boolean;
    source_revision?: string;
    builder_id?: string;
    ciih?: string;
    digest?: string;
  };
  signature?: {
    verified?: boolean;
    trusted_identity?: string;
  };
}

export interface DashboardCustomizationBuildResponse {
  build_id?: string;
  state: string;
  ciih?: string;
  digest?: string;
  manifest: DashboardCustomizationManifest;
  inputs?: DashboardCustomizationBuildInputs;
  trust_policy?: DashboardCustomizationTrustPolicy;
  gates?: DashboardCustomizationGate[];
  waivers?: DashboardCustomizationWaiver[];
  auto_link_requested?: boolean;
  link_ready: boolean;
  link_blocked_reason?: string;
  reused?: boolean;
  errors?: DashboardCustomizationValidationError[];
  error?: string;
}

export interface DashboardCustomizationStatusResponse {
  state: string;
  customization_enabled: boolean;
  configured_digest?: string;
  active_digest?: string;
  pending_rollout_digest?: string;
  resolved_reasoning: DashboardCustomizationReasoning;
}

export interface DashboardCustomizationLinkResponse {
  build_id?: string;
  state: string;
  ciih?: string;
  digest?: string;
  gates?: DashboardCustomizationGate[];
  linked: boolean;
  configured_digest?: string;
  active_digest?: string;
  link_blocked_reason?: string;
  reused?: boolean;
  error?: string;
}

export interface DashboardCustomizationRollbackResponse {
  current_build_id?: string;
  target_build_id?: string;
  state: string;
  current_digest?: string;
  target_digest?: string;
  previous_digest?: string;
  configured_digest?: string;
  active_digest?: string;
  target_gates?: DashboardCustomizationGate[];
  rolled_back: boolean;
  rollback_blocked_reason?: string;
  error?: string;
}

export interface DashboardCustomizationProfile {
  profile_id?: string;
  name?: string;
  scope?: string;
  manifest_checksum?: string;
  latest_gated_digest?: string;
  created_by?: string;
  updated_at?: string;
  inference_metadata?: Record<string, string>;
  manifest: DashboardCustomizationManifest;
}

export interface DashboardCustomizationInspectResponse {
  state: string;
  manifest: DashboardCustomizationManifest;
  profile: DashboardCustomizationProfile;
  field_confidence?: Record<string, string>;
  non_inferable_fields?: string[];
}

export interface DashboardCustomizationExportResponse {
  artifact_type?: string;
  format?: string;
  path?: string;
  checksum?: string;
  content?: string;
  redaction_applied: boolean;
  scan_passed: boolean;
  findings?: Array<{ rule_id: string; location: string; message: string }>;
  error?: string;
}
