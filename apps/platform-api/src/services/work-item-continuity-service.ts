import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import type { LogService } from '../logging/log-service.js';
import { logWorkItemContinuityTransition } from '../logging/work-item-continuity-log.js';
import {
  evaluatePlaybookRules,
  type PlaybookRuleEvaluationResult,
} from './playbook-rule-evaluation-service.js';

interface WorkItemContinuityContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  current_checkpoint: string | null;
  rework_count: number | null;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  definition: unknown;
}

export interface WorkItemCompletionOutcome extends PlaybookRuleEvaluationResult {
  satisfiedReviewExpectation: boolean;
}

export class WorkItemContinuityService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly logService?: LogService,
  ) {}

  async recordTaskCompleted(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return this.applyRuleOutcome(tenantId, task, 'task_completed', db);
  }

  async recordReviewRejected(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return this.applyRuleOutcome(tenantId, task, 'review_rejected', db);
  }

  async clearReviewExpectation(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const context = await this.loadContext(tenantId, task, db);
    if (!context) {
      return null;
    }

    const checkpointName = readCheckpointName(task, context);
    await db.query(
      `UPDATE workflow_work_items
          SET current_checkpoint = $4,
              next_expected_actor = NULL,
              next_expected_action = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, context.workflow_id, context.work_item_id, checkpointName],
    );

    await logWorkItemContinuityTransition(this.logService, {
      tenantId,
      event: 'review_expectation_cleared',
      task,
      checkpointName,
      stageName: context.stage_name,
      ownerRole: context.owner_role,
      previousNextExpectedActor: context.next_expected_actor,
      previousNextExpectedAction: context.next_expected_action,
      nextExpectedActor: null,
      nextExpectedAction: null,
      previousReworkCount: context.rework_count,
      nextReworkCount: context.rework_count,
    });

    return {
      nextExpectedActor: null,
      nextExpectedAction: null,
      checkpointName,
    };
  }

  private async applyRuleOutcome(
    tenantId: string,
    task: Record<string, unknown>,
    event: 'task_completed' | 'review_rejected',
    db: DatabaseClient | DatabasePool,
  ): Promise<WorkItemCompletionOutcome | null> {
    const context = await this.loadContext(tenantId, task, db);
    if (!context) {
      return null;
    }

    const definition = parsePlaybookDefinition(context.definition);
    const role = readOptionalString(task.role) ?? context.owner_role ?? '';
    const checkpointName = readCheckpointName(task, context);
    const evaluation = await this.resolveEvaluation(
      tenantId,
      context,
      role,
      event,
      evaluatePlaybookRules({
        definition,
        event,
        role,
        checkpointName,
      }),
      db,
    );
    const normalizedEvaluation =
      event === 'task_completed'
        ? gateApprovalTakesPrecedence(definition, checkpointName, evaluation)
        : evaluation;
    const satisfiedReviewExpectation =
      event === 'task_completed'
      && context.next_expected_action === 'review'
      && context.next_expected_actor === role;

    await db.query(
      `UPDATE workflow_work_items
          SET current_checkpoint = $4,
              next_expected_actor = $5,
              next_expected_action = $6,
              rework_count = rework_count + $7,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [
        tenantId,
        context.workflow_id,
        context.work_item_id,
        checkpointName,
        normalizedEvaluation.nextExpectedActor,
        normalizedEvaluation.nextExpectedAction,
        normalizedEvaluation.reworkDelta,
      ],
    );

    await logWorkItemContinuityTransition(this.logService, {
      tenantId,
      event,
      task,
      checkpointName,
      stageName: context.stage_name,
      ownerRole: context.owner_role,
      previousNextExpectedActor: context.next_expected_actor,
      previousNextExpectedAction: context.next_expected_action,
      nextExpectedActor: normalizedEvaluation.nextExpectedActor,
      nextExpectedAction: normalizedEvaluation.nextExpectedAction,
      previousReworkCount: context.rework_count,
      nextReworkCount:
        typeof context.rework_count === 'number'
          ? context.rework_count + normalizedEvaluation.reworkDelta
          : normalizedEvaluation.reworkDelta,
      matchedRuleType: normalizedEvaluation.matchedRuleType,
      requiresHumanApproval: normalizedEvaluation.requiresHumanApproval,
      satisfiedReviewExpectation,
      reworkDelta: normalizedEvaluation.reworkDelta,
    });

    return {
      ...normalizedEvaluation,
      satisfiedReviewExpectation,
    };
  }

  private async resolveEvaluation(
    tenantId: string,
    context: WorkItemContinuityContextRow,
    role: string,
    event: 'task_completed' | 'review_rejected',
    evaluation: PlaybookRuleEvaluationResult,
    db: DatabaseClient | DatabasePool,
  ) {
    if (event !== 'review_rejected' || evaluation.nextExpectedActor) {
      return evaluation;
    }

    const predecessorRole = await this.loadLatestHandoffRole(
      tenantId,
      context.workflow_id,
      context.work_item_id,
      db,
    );
    if (!predecessorRole || predecessorRole === role) {
      return evaluation;
    }

    return {
      matchedRuleType: evaluation.matchedRuleType ?? 'review',
      nextExpectedActor: predecessorRole,
      nextExpectedAction: 'rework',
      requiresHumanApproval: false,
      reworkDelta: Math.max(evaluation.reworkDelta, 1),
    } satisfies PlaybookRuleEvaluationResult;
  }

  private async loadContext(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool,
  ): Promise<WorkItemContinuityContextRow | null> {
    const workflowId = readOptionalString(task.workflow_id);
    const workItemId = readOptionalString(task.work_item_id);
    if (!workflowId || !workItemId) {
      return null;
    }

    const result = await db.query<WorkItemContinuityContextRow>(
      `SELECT wi.workflow_id,
              wi.id AS work_item_id,
              wi.stage_name,
              wi.current_checkpoint,
              wi.rework_count,
              wi.owner_role,
              wi.next_expected_actor,
              wi.next_expected_action,
              pb.definition
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
         JOIN playbooks pb
           ON pb.tenant_id = w.tenant_id
          AND pb.id = w.playbook_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows[0] ?? null;
  }

  private async loadLatestHandoffRole(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<{ role: string | null }>(
      `SELECT role
         FROM task_handoffs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
        ORDER BY sequence DESC, created_at DESC
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    return readOptionalString(result.rows[0]?.role);
  }
}

function readCheckpointName(
  task: Record<string, unknown>,
  context: WorkItemContinuityContextRow,
) {
  return (
    readOptionalString(task.stage_name)
    ?? context.current_checkpoint
    ?? context.stage_name
    ?? null
  );
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function gateApprovalTakesPrecedence(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
  evaluation: PlaybookRuleEvaluationResult,
): PlaybookRuleEvaluationResult {
  if (!checkpointRequiresHumanApproval(definition, checkpointName)) {
    return evaluation;
  }
  return {
    matchedRuleType: 'approval',
    nextExpectedActor: 'human',
    nextExpectedAction: 'approve',
    requiresHumanApproval: true,
    reworkDelta: evaluation.reworkDelta,
  };
}

function checkpointRequiresHumanApproval(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
) {
  if (!checkpointName) {
    return false;
  }
  if (definition.checkpoints.some((checkpoint) => checkpoint.name === checkpointName && checkpoint.human_gate)) {
    return true;
  }
  return definition.approval_rules.some((rule) => {
    if (rule.required === false || rule.on !== 'checkpoint') {
      return false;
    }
    return rule.checkpoint === checkpointName;
  });
}
