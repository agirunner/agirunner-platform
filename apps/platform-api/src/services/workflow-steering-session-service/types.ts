export type WorkflowSteeringSourceKind = 'operator' | 'platform' | 'system';
export type WorkflowSteeringMessageKind =
  | 'operator_request'
  | 'steering_response'
  | 'system_notice';
export type WorkflowSteeringSessionStatus = 'open' | 'closed' | 'archived';

export interface WorkflowSteeringSessionRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  title: string | null;
  status: WorkflowSteeringSessionStatus;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
}

export interface WorkflowSteeringMessageRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  steering_session_id: string;
  source_kind: WorkflowSteeringSourceKind;
  message_kind: WorkflowSteeringMessageKind;
  headline: string;
  body: string | null;
  linked_intervention_id: string | null;
  linked_input_packet_id: string | null;
  linked_operator_update_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
}

export interface WorkflowTaskScopeRow {
  work_item_id: string | null;
}

export interface WorkflowSteeringSessionRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  title: string | null;
  status: WorkflowSteeringSessionStatus;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface WorkflowSteeringMessageRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  steering_session_id: string;
  source_kind: WorkflowSteeringSourceKind;
  message_kind: WorkflowSteeringMessageKind;
  headline: string;
  body: string | null;
  linked_intervention_id: string | null;
  linked_input_packet_id: string | null;
  linked_operator_update_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
}

export interface WorkflowSteeringRequestResult {
  outcome: 'applied';
  result_kind: 'steering_request_recorded';
  source_workflow_id: string;
  workflow_id: string;
  resulting_work_item_id: string | null;
  input_packet_id: string | null;
  intervention_id: string | null;
  snapshot_version: string | null;
  settings_revision: number | null;
  message: string;
  redrive_lineage: null;
  steering_session_id: string;
  request_message_id: string;
  response_message_id: string | null;
  linked_intervention_ids: string[];
  linked_input_packet_ids: string[];
}
