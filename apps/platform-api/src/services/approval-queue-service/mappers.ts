import { sanitizeSecretLikeValue } from '../secret-redaction.js';

import type { ApprovalTaskRow } from './types.js';

export function toTaskApproval(row: ApprovalTaskRow) {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    workflow_id: row.workflow_id,
    workflow_name: row.workflow_name,
    work_item_id: row.work_item_id,
    work_item_title: row.work_item_title,
    stage_name: row.stage_name,
    next_expected_actor: row.next_expected_actor,
    next_expected_action: row.next_expected_action,
    role: row.role,
    activation_id: row.activation_id,
    rework_count: row.rework_count ?? 0,
    handoff_count: row.handoff_count ?? 0,
    latest_handoff: row.latest_handoff_summary
      ? {
          role: row.latest_handoff_role,
          stage_name: row.latest_handoff_stage_name,
          summary: sanitizeSecretLikeValue(row.latest_handoff_summary),
          completion: row.latest_handoff_completion,
          successor_context: sanitizeSecretLikeValue(row.latest_handoff_successor_context),
          created_at: row.latest_handoff_created_at?.toISOString() ?? null,
        }
      : null,
    created_at: row.created_at.toISOString(),
    output: sanitizeSecretLikeValue(row.output),
  };
}
