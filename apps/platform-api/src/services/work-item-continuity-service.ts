import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import type { LogService } from '../logging/log-service.js';
import { logWorkItemContinuityTransition } from '../logging/work-item-continuity-log.js';
import { resolveAssessmentOutcomeAction } from './playbook-governance-policy.js';
import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from './assessment-subject-service.js';
import {
  evaluatePlaybookRules,
  type PlaybookRuleEvaluationResult,
} from './playbook-rule-evaluation-service.js';
import {
  PLATFORM_CONTINUITY_STALE_WRITE_SUPPRESSION_ID,
  PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID,
  mustGetSafetynetEntry,
} from './safetynet/registry.js';
import { logSafetynetTriggered } from './safetynet/logging.js';

const REWORK_ROUTE_INFERENCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID,
);
const CONTINUITY_STALE_WRITE_SUPPRESSION_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTINUITY_STALE_WRITE_SUPPRESSION_ID,
);

interface WorkItemContinuityContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  rework_count: number | null;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  definition: unknown;
}

interface CurrentFinishStateRow {
  next_expected_actor: string | null;
  next_expected_action: string | null;
  parent_work_item_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface WorkflowActivationQueuedAtRow {
  queued_at: Date | null;
}

interface NewerSpecialistHandoffRow {
  has_newer_specialist_handoff: boolean;
}

export interface WorkItemCompletionOutcome extends PlaybookRuleEvaluationResult {
  satisfiedAssessmentExpectation: boolean;
}

export interface OrchestratorFinishStateUpdate {
  next_expected_actor?: string | null;
  next_expected_action?: string | null;
  status_summary?: string;
  next_expected_event?: string;
  blocked_on?: string[];
  active_subordinate_tasks?: string[];
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

  async recordAssessmentRequestedChanges(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return this.applyRuleOutcome(tenantId, task, 'assessment_requested_changes', db);
  }

  async clearAssessmentExpectation(
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
          SET next_expected_actor = NULL,
              next_expected_action = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, context.workflow_id, context.work_item_id],
    );

    await logWorkItemContinuityTransition(this.logService, {
      tenantId,
      event: 'assessment_expectation_cleared',
      task,
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

  async persistOrchestratorFinishState(
    tenantId: string,
    task: Record<string, unknown>,
    update: OrchestratorFinishStateUpdate,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const workflowId = readOptionalString(task.workflow_id);
    const workItemId = readOptionalString(task.work_item_id);
    if (!workflowId || !workItemId) {
      return null;
    }

    const current = await this.loadCurrentFinishState(tenantId, workflowId, workItemId, db);
    if (!current) {
      return null;
    }

    const continuityMetadata = compactRecord({
      status_summary: readOptionalString(update.status_summary),
      next_expected_event: readOptionalString(update.next_expected_event),
      blocked_on: normalizeStringList(update.blocked_on),
      active_subordinate_tasks: normalizeStringList(update.active_subordinate_tasks),
    });
    const currentContinuity = readFinishStateContinuity(current.metadata);
    if (
      await this.hasNewerSpecialistHandoffSinceActivation(
        tenantId,
        workflowId,
        workItemId,
        current.parent_work_item_id,
        readOptionalString(task.activation_id),
        db,
      )
    ) {
      await logWorkItemContinuityTransition(this.logService, {
        tenantId,
        event: 'finish_state_skipped',
        task,
        stageName: readOptionalString(task.stage_name),
        ownerRole: readOptionalString(task.role),
        previousNextExpectedActor: current.next_expected_actor,
        previousNextExpectedAction: current.next_expected_action,
        nextExpectedActor: current.next_expected_actor,
        nextExpectedAction: current.next_expected_action,
        previousReworkCount: null,
        nextReworkCount: null,
        statusSummary: readOptionalString(currentContinuity.status_summary),
        nextExpectedEvent: readOptionalString(currentContinuity.next_expected_event),
        blockedOn: normalizeStringList(currentContinuity.blocked_on) ?? null,
        activeSubordinateTasks:
          normalizeStringList(currentContinuity.active_subordinate_tasks) ?? null,
        safetynetBehaviorId: CONTINUITY_STALE_WRITE_SUPPRESSION_SAFETYNET.id,
      });

      return {
        nextExpectedActor: current.next_expected_actor,
        nextExpectedAction: current.next_expected_action,
        continuity: currentContinuity,
      };
    }

    const metadataPatch = {
      orchestrator_finish_state: continuityMetadata,
    };

    const result = await db.query<{
      next_expected_actor: string | null;
      next_expected_action: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `UPDATE workflow_work_items
          SET next_expected_actor = $4,
              next_expected_action = $5,
              metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
      RETURNING next_expected_actor, next_expected_action, metadata`,
      [
        tenantId,
        workflowId,
        workItemId,
        current.next_expected_actor,
        current.next_expected_action,
        metadataPatch,
      ],
    );
    if (!result.rowCount) {
      return null;
    }

    const stored = result.rows[0];
    await logWorkItemContinuityTransition(this.logService, {
      tenantId,
      event: 'finish_state_persisted',
      task,
      stageName: readOptionalString(task.stage_name),
      ownerRole: readOptionalString(task.role),
      previousNextExpectedActor: null,
      previousNextExpectedAction: null,
      nextExpectedActor: stored.next_expected_actor,
      nextExpectedAction: stored.next_expected_action,
      previousReworkCount: null,
      nextReworkCount: null,
      statusSummary: readOptionalString(update.status_summary),
      nextExpectedEvent: readOptionalString(update.next_expected_event),
      blockedOn: normalizeStringList(update.blocked_on) ?? null,
      activeSubordinateTasks: normalizeStringList(update.active_subordinate_tasks) ?? null,
    });

    return {
      nextExpectedActor: stored.next_expected_actor,
      nextExpectedAction: stored.next_expected_action,
      continuity: continuityMetadata,
    };
  }

  private async loadCurrentFinishState(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<CurrentFinishStateRow>(
      `SELECT next_expected_actor,
              next_expected_action,
              parent_work_item_id,
              metadata
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows[0] ?? null;
  }

  private async hasNewerSpecialistHandoffSinceActivation(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    parentWorkItemId: string | null,
    activationId: string | null,
    db: DatabaseClient | DatabasePool,
  ) {
    if (!activationId) {
      return false;
    }

    const activationResult = await db.query<WorkflowActivationQueuedAtRow>(
      `SELECT queued_at
         FROM workflow_activations
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        LIMIT 1`,
      [tenantId, workflowId, activationId],
    );
    const queuedAt = activationResult.rows[0]?.queued_at;
    if (!(queuedAt instanceof Date)) {
      return false;
    }

    const scopedWorkItemIds = [workItemId];
    if (parentWorkItemId) {
      scopedWorkItemIds.push(parentWorkItemId);
    }

    const handoffResult = await db.query<NewerSpecialistHandoffRow>(
      `SELECT EXISTS (
          SELECT 1
            FROM task_handoffs h
            JOIN tasks t
              ON t.tenant_id = h.tenant_id
             AND t.id = h.task_id
           WHERE h.tenant_id = $1
             AND h.workflow_id = $2
             AND h.created_at > $3
             AND COALESCE(t.role, '') <> 'orchestrator'
             AND h.work_item_id = ANY($4::uuid[])
        ) AS has_newer_specialist_handoff`,
      [tenantId, workflowId, queuedAt, scopedWorkItemIds],
    );
    return handoffResult.rows[0]?.has_newer_specialist_handoff ?? false;
  }

  private async applyRuleOutcome(
    tenantId: string,
    task: Record<string, unknown>,
    event: 'task_completed' | 'assessment_requested_changes',
    db: DatabaseClient | DatabasePool,
  ): Promise<WorkItemCompletionOutcome | null> {
    const context = await this.loadContext(tenantId, task, db);
    if (!context) {
      return null;
    }

    const definition = parsePlaybookDefinition(context.definition);
    const role = readOptionalString(task.role) ?? context.owner_role ?? '';
    const checkpointName = readCheckpointName(task, context);
    const subjectRole = await this.resolveAssessmentSubjectRole(
      tenantId,
      context,
      task,
      role,
      event,
      db,
    );
    const evaluation = await this.resolveEvaluation(
      tenantId,
      definition,
      context,
      role,
      subjectRole,
      event,
      task,
      evaluatePlaybookRules({
        definition,
        event,
        role: subjectRole ?? role,
        checkpointName,
        decisionState: readDecisionState(task),
      }),
      db,
    );
    const normalizedEvaluation =
      event === 'task_completed'
        ? gateApprovalTakesPrecedence(definition, checkpointName, evaluation)
        : evaluation;
    const satisfiedAssessmentExpectation =
      event === 'task_completed'
      && context.next_expected_action === 'assess'
      && context.next_expected_actor === role;

    await db.query(
      `UPDATE workflow_work_items
          SET next_expected_actor = $4,
              next_expected_action = $5,
              rework_count = rework_count + $6,
              metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state',
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [
        tenantId,
        context.workflow_id,
        context.work_item_id,
        normalizedEvaluation.nextExpectedActor,
        normalizedEvaluation.nextExpectedAction,
        normalizedEvaluation.reworkDelta,
      ],
    );

    await logWorkItemContinuityTransition(this.logService, {
      tenantId,
      event,
      task,
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
      satisfiedAssessmentExpectation,
      reworkDelta: normalizedEvaluation.reworkDelta,
    });

    return {
      ...normalizedEvaluation,
      satisfiedAssessmentExpectation,
    };
  }

  private async resolveEvaluation(
    tenantId: string,
    definition: ReturnType<typeof parsePlaybookDefinition>,
    context: WorkItemContinuityContextRow,
    role: string,
    subjectRole: string | null,
    event: 'task_completed' | 'assessment_requested_changes',
    task: Record<string, unknown>,
    evaluation: PlaybookRuleEvaluationResult,
    db: DatabaseClient | DatabasePool,
  ) {
    if (event !== 'assessment_requested_changes' || evaluation.nextExpectedActor) {
      return evaluation;
    }

    const outcomeAction = resolveAssessmentOutcomeAction({
      definition,
      subjectRole,
      assessorRole: role,
      checkpointName: readCheckpointName(task, context),
      decisionState: readDecisionState(task) ?? 'request_changes',
    });
    if (outcomeAction?.action === 'route_to_role' && outcomeAction.role) {
      return {
        matchedRuleType: 'assessment',
        nextExpectedActor: outcomeAction.role,
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: Math.max(evaluation.reworkDelta, 1),
      } satisfies PlaybookRuleEvaluationResult;
    }
    if (outcomeAction?.action === 'reopen_subject' && subjectRole) {
      return {
        matchedRuleType: 'assessment',
        nextExpectedActor: subjectRole,
        nextExpectedAction: 'rework',
        requiresHumanApproval: false,
        reworkDelta: Math.max(evaluation.reworkDelta, 1),
      } satisfies PlaybookRuleEvaluationResult;
    }
    if (outcomeAction) {
      return evaluation;
    }

    const reworkActor = await this.resolveAssessmentReworkActor(
      tenantId,
      context,
      task,
      role,
      db,
    );
    if (!reworkActor) {
      return evaluation;
    }
    logSafetynetTriggered(
      REWORK_ROUTE_INFERENCE_SAFETYNET,
      'rework route inferred from assessment lineage',
      {
        workflow_id: context.workflow_id,
        work_item_id: context.work_item_id,
        role,
      },
    );

    return {
      matchedRuleType: evaluation.matchedRuleType ?? 'assessment',
      nextExpectedActor: reworkActor,
      nextExpectedAction: 'rework',
      requiresHumanApproval: false,
      reworkDelta: Math.max(evaluation.reworkDelta, 1),
    } satisfies PlaybookRuleEvaluationResult;
  }

  private async resolveAssessmentSubjectRole(
    tenantId: string,
    context: WorkItemContinuityContextRow,
    task: Record<string, unknown>,
    role: string,
    event: 'task_completed' | 'assessment_requested_changes',
    db: DatabaseClient | DatabasePool,
  ) {
    if (event !== 'assessment_requested_changes') {
      return role;
    }

    const taskKind = readWorkflowTaskKind(task.metadata, task.is_orchestrator_task === true);
    if (taskKind !== 'assessment') {
      return role;
    }

    const linkage = readAssessmentSubjectLinkage(task.input, task.metadata);
    if (!linkage.subjectTaskId) {
      return role;
    }

    return await this.loadTaskRole(
      tenantId,
      context.workflow_id,
      linkage.subjectTaskId,
      db,
    );
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

  private async resolveAssessmentReworkActor(
    tenantId: string,
    context: WorkItemContinuityContextRow,
    task: Record<string, unknown>,
    role: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const taskKind = readWorkflowTaskKind(task.metadata, task.is_orchestrator_task === true);
    if (taskKind !== 'assessment' && role.length > 0) {
      return role;
    }

    const linkage = readAssessmentSubjectLinkage(task.input, task.metadata);
    if (linkage.subjectTaskId) {
      const subjectRole = await this.loadTaskRole(
        tenantId,
        context.workflow_id,
        linkage.subjectTaskId,
        db,
      );
      if (subjectRole) {
        return subjectRole;
      }
    }

    return this.loadLatestDeliveryHandoffRole(
      tenantId,
      context.workflow_id,
      context.work_item_id,
      db,
    );
  }

  private async loadTaskRole(
    tenantId: string,
    workflowId: string,
    taskId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<{ role: string | null }>(
      `SELECT role
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        LIMIT 1`,
      [tenantId, workflowId, taskId],
    );
    return readOptionalString(result.rows[0]?.role);
  }

  private async loadLatestDeliveryHandoffRole(
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
          AND COALESCE(role_data->>'task_kind', '') = 'delivery'
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
    ?? context.stage_name
    ?? null
  );
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readDecisionState(task: Record<string, unknown>) {
  const metadata = asRecord(task.metadata);
  const action = readOptionalString(metadata.assessment_action);
  if (action === 'request_changes') {
    return 'request_changes';
  }
  if (action === 'reject') {
    return 'rejected';
  }
  if (action === 'block') {
    return 'blocked';
  }
  return null;
}

function normalizeStringList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const filtered = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

function readFinishStateContinuity(metadata: Record<string, unknown> | null | undefined) {
  const raw = compactRecord(asRecord(asRecord(metadata).orchestrator_finish_state));
  return compactRecord({
    status_summary: readOptionalString(raw.status_summary),
    next_expected_event: readOptionalString(raw.next_expected_event),
    blocked_on: normalizeStringList(raw.blocked_on as string[] | undefined),
    active_subordinate_tasks: normalizeStringList(raw.active_subordinate_tasks as string[] | undefined),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
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
  void definition;
  void checkpointName;
  return false;
}
