import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import {
  evaluatePlaybookRules,
  type PlaybookRuleEvaluationResult,
} from './playbook-rule-evaluation-service.js';

interface WorkItemContinuityContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  current_checkpoint: string | null;
  owner_role: string | null;
  definition: unknown;
}

export class WorkItemContinuityService {
  constructor(private readonly pool: DatabasePool) {}

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
  ): Promise<PlaybookRuleEvaluationResult | null> {
    const context = await this.loadContext(tenantId, task, db);
    if (!context) {
      return null;
    }

    const definition = parsePlaybookDefinition(context.definition);
    const role = readOptionalString(task.role) ?? context.owner_role ?? '';
    const checkpointName = readCheckpointName(task, context);
    const evaluation = evaluatePlaybookRules({
      definition,
      event,
      role,
      checkpointName,
    });

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
        evaluation.nextExpectedActor,
        evaluation.nextExpectedAction,
        evaluation.reworkDelta,
      ],
    );

    return evaluation;
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
              wi.owner_role,
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
