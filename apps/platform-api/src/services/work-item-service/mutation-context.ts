import { ConflictError, NotFoundError } from '../../errors/domain-errors.js';
import { loadWorkflowStageProjection } from '../workflow-stage-projection.js';
import type { DatabaseClient } from '../../db/database.js';
import type { WorkflowStageContextRow } from './types.js';

export async function loadWorkflowForUpdate(
  tenantId: string,
  workflowId: string,
  client: DatabaseClient,
) {
  const result = await client.query(
    `SELECT w.id,
            w.lifecycle,
            w.state,
            w.metadata,
            p.definition
       FROM workflows w
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = $2
      FOR UPDATE OF w`,
    [tenantId, workflowId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Playbook workflow not found');
  }
  const workflow = result.rows[0] as WorkflowStageContextRow;
  if (Object.hasOwn(workflow, 'active_stage_name')) {
    return {
      ...workflow,
      active_stage_name: typeof workflow.active_stage_name === 'string' ? workflow.active_stage_name : null,
    } satisfies WorkflowStageContextRow;
  }
  const projection = await loadWorkflowStageProjection(client, tenantId, workflowId, {
    lifecycle: workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned',
    definition: workflow.definition,
  });
  return {
    ...workflow,
    active_stage_name: projection.currentStage,
  } satisfies WorkflowStageContextRow;
}

export function assertWorkflowAcceptsWorkItemMutation(workflow: WorkflowStageContextRow) {
  const metadata = asRecord(workflow.metadata);
  if (typeof metadata.cancel_requested_at === 'string' && metadata.cancel_requested_at.trim().length > 0) {
    throw new ConflictError('Workflow cancellation is already in progress');
  }
  if (
    workflow.state === 'paused'
    || (typeof metadata.pause_requested_at === 'string' && metadata.pause_requested_at.trim().length > 0)
  ) {
    throw new ConflictError('Workflow is paused');
  }
  if (workflow.state === 'cancelled') {
    throw new ConflictError('Cancelled workflows cannot accept new work items');
  }
  if (workflow.state === 'completed') {
    throw new ConflictError('Completed workflows cannot accept new work items');
  }
  if (workflow.state === 'failed') {
    throw new ConflictError('Failed workflows cannot accept new work items');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
