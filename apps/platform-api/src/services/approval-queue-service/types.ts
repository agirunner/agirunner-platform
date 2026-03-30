import type { WorkflowStageGateRecord } from '../workflow-stage-gate-service.js';

export interface ApprovalTaskRow {
  id: string;
  title: string;
  state: string;
  workflow_id: string | null;
  workflow_name: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
  stage_name: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  role: string | null;
  activation_id: string | null;
  rework_count: number | null;
  handoff_count: number | null;
  latest_handoff_role: string | null;
  latest_handoff_stage_name: string | null;
  latest_handoff_summary: string | null;
  latest_handoff_completion: string | null;
  latest_handoff_successor_context: string | null;
  latest_handoff_created_at: Date | null;
  created_at: Date;
  output: unknown;
}

export interface ApprovalStageRow extends WorkflowStageGateRecord {
  workflow_id: string;
  workflow_name: string;
  stage_id: string;
  stage_name: string;
  stage_goal: string | null;
  status: string;
  request_summary: string | null;
  updated_at: Date;
  decision_history: unknown;
}
