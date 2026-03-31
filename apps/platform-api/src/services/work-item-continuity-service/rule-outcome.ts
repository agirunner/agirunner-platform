import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { LogService } from '../../logging/log-service.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import {
  PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import { readAssessmentSubjectLinkage, readWorkflowTaskKind } from '../assessment-subject-service.js';
import {
  evaluatePlaybookRules,
  type PlaybookRuleEvaluationResult,
} from '../playbook/playbook-rule-evaluation-service.js';
import { resolveAssessmentOutcomeAction } from '../playbook/playbook-governance-policy.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import type {
  WorkItemCompletionOutcome,
  WorkItemContinuityContextRow,
} from './types.js';
import {
  gateApprovalTakesPrecedence,
  readCheckpointName,
  readDecisionState,
} from './value-helpers.js';
import {
  loadContext,
  loadLatestDeliveryHandoffRole,
  loadTaskRole,
} from './query-helpers.js';

const REWORK_ROUTE_INFERENCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID,
);

export async function applyRuleOutcome(
  logService: LogService | undefined,
  tenantId: string,
  task: Record<string, unknown>,
  event: 'task_completed' | 'assessment_requested_changes',
  db: DatabaseClient | DatabasePool,
): Promise<WorkItemCompletionOutcome | null> {
  const context = await loadContext(tenantId, task, db);
  if (!context) {
    return null;
  }

  const definition = parsePlaybookDefinition(context.definition);
  const role = readOptionalString(task.role) ?? context.owner_role ?? '';
  const checkpointName = readCheckpointName(task, context);
  const subjectRole = await resolveAssessmentSubjectRole(
    tenantId,
    context,
    task,
    role,
    event,
    db,
  );
  const evaluation = await resolveEvaluation(
    logService,
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

  return {
    ...normalizedEvaluation,
    satisfiedAssessmentExpectation,
  };
}

async function resolveEvaluation(
  logService: LogService | undefined,
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

  const reworkActor = await resolveAssessmentReworkActor(
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
    mustGetSafetynetEntry(PLATFORM_ORCHESTRATOR_REWORK_ROUTE_INFERENCE_ID),
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

async function resolveAssessmentSubjectRole(
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

  return await loadTaskRole(
    tenantId,
    context.workflow_id,
    linkage.subjectTaskId,
    db,
  );
}

async function resolveAssessmentReworkActor(
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
    const subjectRole = await loadTaskRole(
      tenantId,
      context.workflow_id,
      linkage.subjectTaskId,
      db,
    );
    if (subjectRole) {
      return subjectRole;
    }
  }

  return loadLatestDeliveryHandoffRole(
    tenantId,
    context.workflow_id,
    context.work_item_id,
    db,
  );
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function checkpointRequiresHumanApproval(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
) {
  void definition;
  void checkpointName;
  return false;
}
