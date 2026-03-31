export interface ArtifactRow {
  id: string;
  task_id: string;
  logical_path: string | null;
  content_type: string | null;
  size_bytes: number | null;
}

export interface ExistingDescriptorRow {
  id: string;
  work_item_id: string | null;
}

export interface WorkflowOperatorBriefRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  brief_kind: string;
  brief_scope: string;
  source_kind: string;
  source_role_name: string | null;
  llm_turn_count: number | null;
  status_kind: string;
  short_brief: Record<string, unknown>;
  detailed_brief_json: Record<string, unknown>;
  linked_target_ids: string[] | null;
  sequence_number: number;
  related_artifact_ids: string[] | null;
  related_output_descriptor_ids: string[] | null;
  related_intervention_ids: string[] | null;
  canonical_workflow_brief_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
}
