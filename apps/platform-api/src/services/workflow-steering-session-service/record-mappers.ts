import type {
  WorkflowSteeringMessageRecord,
  WorkflowSteeringMessageRow,
  WorkflowSteeringSessionRecord,
  WorkflowSteeringSessionRow,
} from './types.js';

export function toWorkflowSteeringSessionRecord(
  row: WorkflowSteeringSessionRow,
): WorkflowSteeringSessionRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    title: row.title,
    status: row.status,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    last_message_at: row.last_message_at ? row.last_message_at.toISOString() : null,
  };
}

export function toWorkflowSteeringMessageRecord(
  row: WorkflowSteeringMessageRow,
): WorkflowSteeringMessageRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    steering_session_id: row.steering_session_id,
    source_kind: row.source_kind,
    message_kind: row.message_kind,
    headline: row.headline,
    body: row.body,
    linked_intervention_id: row.linked_intervention_id,
    linked_input_packet_id: row.linked_input_packet_id,
    linked_operator_update_id: row.linked_operator_update_id,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
  };
}
