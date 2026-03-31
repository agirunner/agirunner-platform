
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { NotFoundError } from '../../errors/domain-errors.js';
import { completionCalloutsSchema } from '../guided-closure/types.js';
import { loadWorkflowStageProjection } from '../workflow-stage-projection.js';
import type {
  WorkflowContextRow,
  WorkflowStageGateRow,
  WorkflowStageRow,
  WorkflowWorkItemRow,
} from './playbook-workflow-control-types.js';

export async function loadWorkflowImpl(this: any,tenantId: string, workflowId: string, db: DatabaseClient | DatabasePool) {
  const result = await db.query<WorkflowContextRow>(
    `SELECT w.id,
            w.workspace_id,
            w.playbook_id,
            w.lifecycle,
            w.state,
            p.definition,
            w.orchestration_state,
            w.completion_callouts
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
  const workflow = result.rows[0] as WorkflowContextRow;
  if (Object.hasOwn(workflow, 'active_stage_name')) {
    return {
      ...workflow,
      active_stage_name: typeof workflow.active_stage_name === 'string' ? workflow.active_stage_name : null,
    } satisfies WorkflowContextRow;
  }
  const projection = await loadWorkflowStageProjection(db, tenantId, workflowId, {
    lifecycle: workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned',
    definition: workflow.definition,
  });
  return {
    ...workflow,
    active_stage_name: projection.currentStage,
  } satisfies WorkflowContextRow;
}

export async function loadWorkItemImpl(this: any,
  tenantId: string,
  workflowId: string,
  workItemId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<WorkflowWorkItemRow>(
    `SELECT id,
            parent_work_item_id,
            stage_name,
            title,
            goal,
            acceptance_criteria,
            column_id,
            owner_role,
            next_expected_actor,
            next_expected_action,
            blocked_state,
            blocked_reason,
            escalation_status,
            rework_count,
            priority,
            notes,
            completed_at,
            metadata,
            completion_callouts,
            updated_at
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      FOR UPDATE`,
    [tenantId, workflowId, workItemId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Workflow work item not found');
  }
  return result.rows[0];
}

export async function loadWorkflowCompletionCalloutsImpl(this: any,
  tenantId: string,
  workflowId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<{ completion_callouts: unknown }>(
    `SELECT completion_callouts
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2`,
    [tenantId, workflowId],
  );
  return result.rows.map((row) => completionCalloutsSchema.parse(row.completion_callouts ?? {}));
}

export async function loadStageImpl(this: any,
  tenantId: string,
  workflowId: string,
  stageName: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<WorkflowStageRow>(
    `SELECT id, name, position, goal, guidance, status, gate_status,
            iteration_count, summary, metadata, started_at, completed_at, updated_at
       FROM workflow_stages
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND name = $3
      FOR UPDATE`,
    [tenantId, workflowId, stageName],
  );
  if (!result.rowCount) {
    throw new NotFoundError(`Workflow stage '${stageName}' not found`);
  }
  return result.rows[0];
}

export async function loadAwaitingGateImpl(this: any,
  tenantId: string,
  workflowId: string,
  stageId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<WorkflowStageGateRow>(
    `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
            concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
            updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at,
            requested_by_work_item_id
       FROM workflow_stage_gates
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND stage_id = $3
        AND status = 'awaiting_approval'
      LIMIT 1`,
    [tenantId, workflowId, stageId],
  );
  return result.rows[0] ?? null;
}

export async function loadAwaitingGateByIdImpl(this: any,
  tenantId: string,
  gateId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<WorkflowStageGateRow>(
    `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
            concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
            updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at,
            requested_by_work_item_id
       FROM workflow_stage_gates
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'awaiting_approval'
      LIMIT 1
      FOR UPDATE`,
    [tenantId, gateId],
  );
  return result.rows[0] ?? null;
}

export async function loadGateByIdImpl(this: any,
  tenantId: string,
  gateId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<WorkflowStageGateRow>(
    `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
            concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
            updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at,
            requested_by_work_item_id
       FROM workflow_stage_gates
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    [tenantId, gateId],
  );
  return result.rows[0] ?? null;
}

export async function loadLatestGateForStageImpl(this: any,
  tenantId: string,
  workflowId: string,
  stageId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<WorkflowStageGateRow>(
    `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
            concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
            updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at,
            requested_by_work_item_id
       FROM workflow_stage_gates
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND stage_id = $3
      ORDER BY requested_at DESC
      LIMIT 1`,
    [tenantId, workflowId, stageId],
  );
  return result.rows[0] ?? null;
}
