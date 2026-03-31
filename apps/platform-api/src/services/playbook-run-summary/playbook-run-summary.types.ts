export interface TimelineEventRow {
  type: string;
  actor_type: string;
  actor_id: string | null;
  data: Record<string, unknown> | null;
  created_at: Date;
}

export interface ArtifactSummaryRow {
  id: string;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  created_at: Date;
}

export interface WorkflowStageSummaryRow {
  name: string;
  goal: string;
  status: string;
  gate_status: string;
  iteration_count: number;
  summary: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface WorkflowWorkItemSummaryRow {
  id: string;
  stage_name: string;
  column_id: string;
  title: string;
  completed_at: Date | null;
}

export interface ActivationBatchSummary {
  activation_id: string;
  status: string;
  reason: string | null;
  task_id: string | null;
  event_count: number;
  trigger_event_types: string[];
  workflow_events: string[];
  latest_event_at: string;
}

export interface WorkflowActivationSummaryRow {
  activation_id: string | null;
  state: string;
  reason: string | null;
  event_type: string;
  task_id: string | null;
  queued_at: Date;
  started_at: Date | null;
  consumed_at: Date | null;
  completed_at: Date | null;
  error: Record<string, unknown> | null;
}

export interface WorkflowGateSummaryRow {
  id: string;
  stage_name: string;
  status: string;
  request_summary: string;
  recommendation: string | null;
  concerns: unknown[];
  key_artifacts: unknown[];
  requested_by_type: string;
  requested_by_id: string | null;
  requested_at: Date;
  decision_feedback: string | null;
  decided_by_type: string | null;
  decided_by_id: string | null;
  decided_at: Date | null;
}

export interface EscalationChainSummary {
  source_task_id: string;
  escalation_task_id: string | null;
  target_role: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  status: string;
  event_types: string[];
  latest_event_at: string;
}

export interface BuildPlaybookRunSummaryParams {
  workflow: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  stages: WorkflowStageSummaryRow[];
  workItems: WorkflowWorkItemSummaryRow[];
  events: TimelineEventRow[];
  artifacts: ArtifactSummaryRow[];
  activations?: WorkflowActivationSummaryRow[];
  gates?: WorkflowGateSummaryRow[];
}
