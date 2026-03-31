interface WorkflowRow {
  id: string;
  name: string;
  state: string;
  lifecycle: string | null;
  current_stage: string | null;
  metadata: Record<string, unknown> | null;
  workspace_id: string | null;
  workspace_name: string | null;
  playbook_id: string | null;
  playbook_name: string | null;
  parameters: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  updated_at: Date | string | null;
}

interface WorkflowSignalRow {
  workflow_id: string;
  waiting_for_decision_count: number;
  open_escalation_count: number;
  blocked_work_item_count: number;
  failed_task_count: number;
  active_task_count: number;
  active_work_item_count: number;
  pending_work_item_count: number;
  recoverable_issue_count: number;
}

interface ArtifactOutputRow {
  workflow_id: string;
  artifact_id: string;
  task_id: string;
  work_item_id: string | null;
  stage_name: string | null;
  task_state: string | null;
  work_item_completed_at: Date | string | null;
  workflow_state: string | null;
  logical_path: string;
  content_type: string | null;
  size_bytes: number | null;
}

interface DocumentOutputRow {
  workflow_id: string;
  document_id: string;
  logical_name: string;
  title: string | null;
  source: 'repository' | 'artifact' | 'external';
  location: string;
  artifact_id: string | null;
}

export type {
  ArtifactOutputRow,
  DocumentOutputRow,
  WorkflowRow,
  WorkflowSignalRow,
};
