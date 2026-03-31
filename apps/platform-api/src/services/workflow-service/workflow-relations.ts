import { asOptionalString, readWorkflowIdArray } from './workflow-read-model.js';

export function buildWorkflowRelations(
  metadata: Record<string, unknown>,
  relatedById: Map<string, Record<string, unknown>>,
) {
  const parentId = asOptionalString(metadata.parent_workflow_id);
  const childIds = readWorkflowIdArray(metadata.child_workflow_ids);
  const parent = parentId ? toWorkflowRelationRef(parentId, relatedById.get(parentId)) : null;
  const children = childIds.map((childId) => toWorkflowRelationRef(childId, relatedById.get(childId)));

  return {
    parent,
    children,
    latest_child_workflow_id: asOptionalString(metadata.latest_child_workflow_id) ?? null,
    child_status_counts: {
      total: children.length,
      active: children.filter((child) =>
        child.state === 'pending' || child.state === 'active' || child.state === 'paused',
      ).length,
      completed: children.filter((child) => child.state === 'completed').length,
      failed: children.filter((child) => child.state === 'failed').length,
      cancelled: children.filter((child) => child.state === 'cancelled').length,
    },
  };
}

function toWorkflowRelationRef(workflowId: string, row?: Record<string, unknown>) {
  return {
    workflow_id: workflowId,
    name: asOptionalString(row?.name) ?? null,
    state: asOptionalString(row?.state) ?? 'unknown',
    playbook_id: asOptionalString(row?.playbook_id) ?? null,
    playbook_name: asOptionalString(row?.playbook_name) ?? null,
    created_at: row?.created_at ?? null,
    started_at: row?.started_at ?? null,
    completed_at: row?.completed_at ?? null,
    is_terminal: ['completed', 'failed', 'cancelled'].includes(asOptionalString(row?.state) ?? ''),
    link: `/workflows/${workflowId}`,
  };
}
