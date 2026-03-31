import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError } from '../../errors/domain-errors.js';

export type BranchTerminationPolicy =
  | 'stop_branch_only'
  | 'stop_branch_and_descendants'
  | 'stop_all_siblings';

interface WorkflowBranchRow {
  id: string;
  parent_branch_id: string | null;
  branch_key: string;
  termination_policy: BranchTerminationPolicy;
  branch_status: 'active' | 'completed' | 'blocked' | 'terminated';
}

interface TerminateWorkflowBranchInput {
  tenantId: string;
  workflowId: string;
  branchId: string;
  terminatedByType: string;
  terminatedById: string;
  terminationReason: string | null;
}

interface EnsureWorkflowBranchInput {
  tenantId: string;
  workflowId: string;
  parentBranchId?: string | null;
  parentSubjectRef?: Record<string, unknown>;
  branchKey: string;
  terminationPolicy: BranchTerminationPolicy;
  metadata?: Record<string, unknown>;
}

export function collectTerminatedBranchIds(
  branches: Array<{ id: string; parent_branch_id: string | null }>,
  branchId: string,
  terminationPolicy: BranchTerminationPolicy,
) {
  if (terminationPolicy === 'stop_branch_only') {
    return [branchId];
  }

  const childrenByParent = new Map<string | null, string[]>();
  for (const branch of branches) {
    const siblings = childrenByParent.get(branch.parent_branch_id) ?? [];
    siblings.push(branch.id);
    childrenByParent.set(branch.parent_branch_id, siblings);
  }

  const expandDescendants = (seedIds: string[]) => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const queue = [...seedIds];
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || seen.has(next)) {
        continue;
      }
      seen.add(next);
      ordered.push(next);
      for (const childId of childrenByParent.get(next) ?? []) {
        queue.push(childId);
      }
    }
    return ordered;
  };

  if (terminationPolicy === 'stop_branch_and_descendants') {
    return expandDescendants([branchId]);
  }

  const target = branches.find((entry) => entry.id === branchId);
  const siblingIds = childrenByParent.get(target?.parent_branch_id ?? null) ?? [branchId];
  return expandDescendants([...siblingIds].sort());
}

export async function terminateWorkflowBranch(
  db: DatabaseClient | DatabasePool,
  input: TerminateWorkflowBranchInput,
) {
  const targetResult = await db.query<WorkflowBranchRow>(
    `SELECT id, parent_branch_id, branch_key, termination_policy, branch_status
       FROM workflow_branches
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
      LIMIT 1`,
    [input.tenantId, input.workflowId, input.branchId],
  );
  const target = targetResult.rows[0];
  if (!target || target.branch_status === 'terminated') {
    return [];
  }

  const branchResult = await db.query<WorkflowBranchRow>(
    `SELECT id, parent_branch_id, branch_key, termination_policy, branch_status
       FROM workflow_branches
      WHERE tenant_id = $1
        AND workflow_id = $2`,
    [input.tenantId, input.workflowId],
  );
  const targetBranchIds = collectTerminatedBranchIds(
    branchResult.rows,
    target.id,
    target.termination_policy,
  );
  if (targetBranchIds.length === 0) {
    return [];
  }

  await db.query(
    `UPDATE workflow_branches
        SET branch_status = 'terminated',
            terminated_by_type = $4,
            terminated_by_id = $5,
            termination_reason = $6,
            terminated_at = COALESCE(terminated_at, now()),
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = ANY($3::uuid[])
        AND branch_status <> 'terminated'`,
    [
      input.tenantId,
      input.workflowId,
      targetBranchIds,
      input.terminatedByType,
      input.terminatedById,
      input.terminationReason,
    ],
  );

  await db.query(
    `UPDATE workflow_work_items
        SET completed_at = COALESCE(completed_at, now()),
            next_expected_actor = NULL,
            next_expected_action = NULL,
            blocked_state = NULL,
            blocked_reason = NULL,
            escalation_status = NULL,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND branch_id = ANY($3::uuid[])
        AND completed_at IS NULL`,
    [input.tenantId, input.workflowId, targetBranchIds],
  );

  await db.query(
    `UPDATE tasks
        SET state = CASE
                      WHEN state IN ('pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'escalated')
                        THEN 'cancelled'::task_state
                      ELSE state
                    END,
            completed_at = CASE
                             WHEN state IN ('pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'escalated')
                               THEN COALESCE(completed_at, now())
                             ELSE completed_at
                           END,
            updated_at = now()
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND branch_id = ANY($3::uuid[])
        AND state IN ('pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment', 'escalated')`,
    [input.tenantId, input.workflowId, targetBranchIds],
  );

  return targetBranchIds;
}

export async function ensureWorkflowBranch(
  db: DatabaseClient | DatabasePool,
  input: EnsureWorkflowBranchInput,
) {
  const existingResult = await db.query<WorkflowBranchRow>(
    `SELECT id, parent_branch_id, branch_key, termination_policy, branch_status
       FROM workflow_branches
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND branch_key = $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.tenantId, input.workflowId, input.branchKey],
  );
  const existing = existingResult.rows[0];
  if (existing) {
    if (existing.termination_policy !== input.terminationPolicy) {
      throw new ConflictError(
        `Existing branch '${input.branchKey}' does not match termination_policy '${input.terminationPolicy}'`,
      );
    }
    if (existing.branch_status === 'terminated') {
      throw new ConflictError(`Cannot create new work for terminated branch '${input.branchKey}'`);
    }
    return existing.id;
  }

  const createdResult = await db.query<{ id: string }>(
    `INSERT INTO workflow_branches (
       tenant_id,
       workflow_id,
       parent_branch_id,
       parent_subject_ref,
       branch_key,
       termination_policy,
       created_by_task_id,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.tenantId,
      input.workflowId,
      input.parentBranchId ?? null,
      input.parentSubjectRef ?? {},
      input.branchKey,
      input.terminationPolicy,
      null,
      input.metadata ?? {},
    ],
  );
  return createdResult.rows[0]?.id ?? null;
}
