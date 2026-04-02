import { ConflictError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { ensureWorkflowBranch } from '../workflow-operations/workflow-branch-service.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import type { DatabaseClient } from '../../db/database.js';
import type {
  CheckpointPredecessorRow,
  CreateWorkItemInput,
  NonTerminalTaskStateCountRow,
  ParentWorkItemBranchRow,
} from './types.js';
import {
  matchesReusablePlannedChildCheckpoint,
  shouldResetReusableChildCheckpoint,
  starterRolesForPlannedStage,
} from './shared.js';
import { workItemColumnList } from './types.js';

export async function resolveCreateWorkItemBranchId(
  tenantId: string,
  workflowId: string,
  definition: ReturnType<typeof parsePlaybookDefinition>,
  input: CreateWorkItemInput,
  client: DatabaseClient,
) {
  const needsParentBranchLookup = Boolean(input.parent_work_item_id) && Boolean(input.branch_key?.trim());
  const parentBranch = needsParentBranchLookup
    ? await loadParentWorkItemBranch(
        tenantId,
        workflowId,
        input.parent_work_item_id ?? null,
        client,
      )
    : null;
  if (parentBranch?.branch_status === 'terminated') {
    throw new ConflictError('Cannot create new work items for a terminated branch');
  }

  const branchKey = input.branch_key?.trim();
  if (!branchKey) {
    return parentBranch?.branch_id ?? null;
  }
  void definition;

  return ensureWorkflowBranch(client, {
    tenantId,
    workflowId,
    parentBranchId: parentBranch?.branch_id ?? null,
    parentSubjectRef: { kind: 'workflow', workflow_id: workflowId },
    branchKey,
    terminationPolicy: 'stop_branch_only',
    metadata: {},
  });
}

export async function resolveHumanGateContinuation(
  tenantId: string,
  workflowId: string,
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string,
  client: DatabaseClient,
) {
  void definition;
  const stageResult = await client.query<{ gate_status: string | null }>(
    `SELECT gate_status
       FROM workflow_stages
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND name = $3
      LIMIT 1`,
    [tenantId, workflowId, stageName],
  );
  const status = stageResult.rows[0]?.gate_status ?? null;
  if (!status || status === 'not_requested' || status === 'approved') {
    return { nextExpectedActor: null, nextExpectedAction: null };
  }

  return { nextExpectedActor: 'human', nextExpectedAction: 'approve' };
}

export async function assertPlannedStageEntryRoleCanStart(
  tenantId: string,
  workflowId: string,
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string,
  ownerRole: string | null,
  client: DatabaseClient,
) {
  const normalizedOwnerRole = ownerRole?.trim() ?? null;
  if (!normalizedOwnerRole) {
    return;
  }

  const starterRoles = starterRolesForPlannedStage(definition, stageName);
  if (starterRoles.length === 0 || starterRoles.includes(normalizedOwnerRole)) {
    return;
  }

  const existingStageWorkItems = await countStageWorkItems(
    tenantId,
    workflowId,
    stageName,
    client,
  );
  if (existingStageWorkItems > 0) {
    return;
  }

  throw new ValidationError(
    `Cannot seed planned stage '${stageName}' with role '${normalizedOwnerRole}' before the required upstream handoff exists. ` +
      `Start with one of: ${starterRoles.join(', ')}.`,
    {
      recovery_hint: 'orchestrator_guided_recovery',
      reason_code: 'planned_stage_starter_role_required',
      stage_name: stageName,
      requested_role: normalizedOwnerRole,
      allowed_starter_roles: starterRoles,
    },
  );
}

export async function reuseOpenPlannedChildCheckpoint(
  tenantId: string,
  workflowId: string,
  parentWorkItemId: string | null,
  stageName: string,
  ownerRole: string | null,
  expected: {
    title: string;
    goal?: string;
    acceptance_criteria?: string;
    column_id: string;
    priority: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  },
  client: DatabaseClient,
): Promise<Record<string, unknown> | null> {
  if (!parentWorkItemId) {
    return null;
  }

  const existing = await client.query(
    `SELECT ${workItemColumnList()}
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND parent_work_item_id = $3
        AND stage_name = $4
        AND COALESCE(owner_role, '') = COALESCE($5, '')
        AND completed_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, workflowId, parentWorkItemId, stageName, ownerRole],
  );
  if (!existing.rowCount) {
    return null;
  }

  const workItem = existing.rows[0] as Record<string, unknown>;
  if (!matchesReusablePlannedChildCheckpoint(workItem, stageName, ownerRole, expected)) {
    return null;
  }
  if (!shouldResetReusableChildCheckpoint(workItem)) {
    return workItem;
  }

  const reset = await client.query(
    `UPDATE workflow_work_items
        SET next_expected_actor = NULL,
            next_expected_action = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
    RETURNING ${workItemColumnList()}`,
    [tenantId, workflowId, workItem.id],
  );
  return (reset.rows[0] as Record<string, unknown> | undefined) ?? workItem;
}

async function loadCheckpointPredecessor(
  tenantId: string,
  workflowId: string,
  parentWorkItemId: string,
  client: DatabaseClient,
) {
  const predecessorResult = await client.query<CheckpointPredecessorRow>(
    `SELECT wi.id,
            wi.title,
            wi.stage_name,
            wi.column_id,
            wi.completed_at,
            wi.next_expected_actor,
            wi.next_expected_action,
            wi.blocked_state,
            wi.blocked_reason,
            wi.escalation_status,
            COALESCE(ws.gate_status, 'not_requested') AS gate_status,
            latest_handoff.latest_handoff_completion,
            latest_handoff.latest_handoff_resolution
       FROM workflow_work_items wi
       LEFT JOIN workflow_stages ws
         ON ws.tenant_id = wi.tenant_id
        AND ws.workflow_id = wi.workflow_id
        AND ws.name = wi.stage_name
       LEFT JOIN LATERAL (
         SELECT th.completion AS latest_handoff_completion,
                th.resolution AS latest_handoff_resolution
           FROM task_handoffs th
          WHERE th.tenant_id = wi.tenant_id
            AND th.workflow_id = wi.workflow_id
            AND th.work_item_id = wi.id
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_handoff ON true
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1
      FOR UPDATE OF wi`,
    [tenantId, workflowId, parentWorkItemId],
  );
  return predecessorResult.rows[0] ?? null;
}

async function countNonTerminalWorkItemTasks(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
) {
  const taskResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND state NOT IN ('completed', 'failed', 'cancelled')`,
    [tenantId, workflowId, workItemId],
  );
  return taskResult.rows[0]?.count ?? 0;
}

async function countStageWorkItems(
  tenantId: string,
  workflowId: string,
  stageName: string,
  client: DatabaseClient,
) {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND stage_name = $3`,
    [tenantId, workflowId, stageName],
  );
  return result.rows[0]?.count ?? 0;
}

async function loadNonTerminalWorkItemTaskStateCounts(
  tenantId: string,
  workflowId: string,
  workItemId: string,
  client: DatabaseClient,
) {
  const taskResult = await client.query<NonTerminalTaskStateCountRow>(
    `SELECT state, COUNT(*)::int AS count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND work_item_id = $3
        AND state NOT IN ('completed', 'failed', 'cancelled')
      GROUP BY state`,
    [tenantId, workflowId, workItemId],
  );
  return taskResult.rows.reduce((counts, row) => {
    counts.set(row.state, row.count);
    return counts;
  }, new Map<string, number>());
}

async function loadParentWorkItemBranch(
  tenantId: string,
  workflowId: string,
  parentWorkItemId: string | null,
  client: DatabaseClient,
) {
  if (!parentWorkItemId) {
    return null;
  }
  const result = await client.query<ParentWorkItemBranchRow>(
    `SELECT wi.branch_id,
            branch.branch_status
       FROM workflow_work_items wi
       LEFT JOIN workflow_branches branch
         ON branch.tenant_id = wi.tenant_id
        AND branch.workflow_id = wi.workflow_id
        AND branch.id = wi.branch_id
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.id = $3
      LIMIT 1`,
    [tenantId, workflowId, parentWorkItemId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Parent workflow work item not found');
  }
  return result.rows[0];
}
