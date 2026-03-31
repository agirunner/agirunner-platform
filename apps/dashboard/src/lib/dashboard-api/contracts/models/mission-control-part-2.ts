import type { DashboardWorkflowOperationsSnapshot, DashboardWorkflowInputPacketRecord, DashboardWorkflowInterventionRecord } from '../models.js';
export interface DashboardWorkflowBriefItem {
  brief_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  brief_kind: string;
  brief_scope: string;
  source_kind: string;
  source_label: string;
  source_role_name: string | null;
  headline: string;
  summary: string;
  llm_turn_count: number | null;
  status_kind: string;
  short_brief: Record<string, unknown>;
  detailed_brief_json: Record<string, unknown>;
  linked_target_ids: string[];
  sequence_number: number;
  related_artifact_ids: string[];
  related_output_descriptor_ids: string[];
  related_intervention_ids: string[];
  canonical_workflow_brief_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardWorkflowBriefsPacket extends DashboardWorkflowOperationsSnapshot {
  items: DashboardWorkflowBriefItem[];
  total_count: number;
  next_cursor: string | null;
}

export interface DashboardWorkflowDeliverableTarget {
  target_kind: string;
  label: string;
  url: string;
  path?: string | null;
  repo_ref?: string | null;
  artifact_id?: string | null;
  size_bytes?: number | null;
}

export interface DashboardWorkflowDeliverableRecord {
  descriptor_id: string;
  workflow_id: string;
  work_item_id: string | null;
  descriptor_kind: string;
  delivery_stage: 'in_progress' | 'final' | string;
  title: string;
  state: 'draft' | 'under_review' | 'approved' | 'superseded' | 'final' | string;
  summary_brief: string | null;
  preview_capabilities: Record<string, unknown>;
  primary_target: DashboardWorkflowDeliverableTarget;
  secondary_targets: DashboardWorkflowDeliverableTarget[];
  content_preview: Record<string, unknown>;
  source_brief_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardWorkflowOperatorBriefRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string | null;
  request_id: string;
  execution_context_id: string;
  brief_kind: string;
  brief_scope: string;
  source_kind: string;
  source_role_name: string | null;
  status_kind: string;
  short_brief: Record<string, unknown>;
  detailed_brief_json: Record<string, unknown>;
  linked_target_ids: string[];
  sequence_number: number;
  related_artifact_ids: string[];
  related_output_descriptor_ids: string[];
  related_intervention_ids: string[];
  canonical_workflow_brief_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardWorkflowDeliverablesPacket {
  final_deliverables: DashboardWorkflowDeliverableRecord[];
  in_progress_deliverables: DashboardWorkflowDeliverableRecord[];
  working_handoffs: DashboardWorkflowOperatorBriefRecord[];
  inputs_and_provenance: {
    launch_packet: DashboardWorkflowInputPacketRecord | null;
    supplemental_packets: DashboardWorkflowInputPacketRecord[];
    intervention_attachments: DashboardWorkflowInterventionRecord[];
    redrive_packet: DashboardWorkflowInputPacketRecord | null;
  };
  next_cursor: string | null;
}

export interface DashboardWorkflowStickyStrip {
  workflow_id: string;
  workflow_name: string;
  posture: string | null;
  summary: string;
  approvals_count: number;
  escalations_count: number;
  blocked_work_item_count: number;
  active_task_count: number;
  active_work_item_count: number;
  steering_available: boolean;
}

export interface DashboardWorkflowBottomTabsPacket {
  default_tab: 'details' | 'needs_action' | 'steering' | 'live_console' | 'history' | 'deliverables';
  current_scope_kind: 'workflow' | 'selected_work_item' | 'selected_task';
  current_work_item_id: string | null;
  current_task_id: string | null;
  counts: {
    details: number;
    needs_action: number;
    steering: number;
    live_console_activity: number;
    briefs?: number;
    history: number;
    deliverables: number;
  };
}

export interface DashboardWorkflowOperationsStreamEvent {
  event_type: string;
  cursor: string;
  snapshot_version: string;
  workflow_id: string | null;
  payload: unknown;
}

export interface DashboardWorkflowOperationsStreamBatch extends DashboardWorkflowOperationsSnapshot {
  cursor: string;
  events: DashboardWorkflowOperationsStreamEvent[];
}
