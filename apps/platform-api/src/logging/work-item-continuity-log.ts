import { randomUUID } from 'node:crypto';

import type { LogService } from './log-service.js';
import { actorFromAuth } from './actor-context.js';
import { getRequestContext } from '../observability/request-context.js';

interface WorkItemContinuityTransitionInput {
  tenantId: string;
  event:
    | 'task_completed'
    | 'assessment_requested_changes'
    | 'assessment_expectation_cleared'
    | 'finish_state_persisted'
    | 'finish_state_skipped';
  task: Record<string, unknown>;
  stageName: string | null;
  ownerRole: string | null;
  previousNextExpectedActor: string | null;
  previousNextExpectedAction: string | null;
  nextExpectedActor: string | null;
  nextExpectedAction: string | null;
  previousReworkCount: number | null;
  nextReworkCount: number | null;
  matchedRuleType?: string | null;
  requiresHumanApproval?: boolean | null;
  satisfiedAssessmentExpectation?: boolean | null;
  reworkDelta?: number | null;
  statusSummary?: string | null;
  nextExpectedEvent?: string | null;
  blockedOn?: string[] | null;
  activeSubordinateTasks?: string[] | null;
  safetynetBehaviorId?: string | null;
}

const CONTINUITY_OPERATION_BY_EVENT: Record<
  WorkItemContinuityTransitionInput['event'],
  string
> = {
  task_completed: 'work_item.continuity.task_completed',
  assessment_requested_changes: 'work_item.continuity.assessment_requested_changes',
  assessment_expectation_cleared: 'work_item.continuity.assessment_expectation_cleared',
  finish_state_persisted: 'work_item.continuity.finish_state_persisted',
  finish_state_skipped: 'work_item.continuity.finish_state_skipped',
};

export async function logWorkItemContinuityTransition(
  logService: LogService | undefined,
  input: WorkItemContinuityTransitionInput,
): Promise<void> {
  if (!logService) {
    return;
  }

  const requestContext = getRequestContext();
  const actor = actorFromAuth(requestContext?.auth);

  try {
    await logService.insert({
      tenantId: input.tenantId,
      traceId: requestContext?.requestId ?? randomUUID(),
      spanId: randomUUID(),
      source: 'platform',
      category: 'task_lifecycle',
      level: 'debug',
      operation: CONTINUITY_OPERATION_BY_EVENT[input.event],
      status: 'completed',
      payload: {
        event: input.event,
        stage_name: input.stageName,
        owner_role: input.ownerRole,
        task_role: readOptionalString(input.task.role),
        previous_next_expected_actor: input.previousNextExpectedActor,
        previous_next_expected_action: input.previousNextExpectedAction,
        next_expected_actor: input.nextExpectedActor,
        next_expected_action: input.nextExpectedAction,
        previous_rework_count: input.previousReworkCount,
        next_rework_count: input.nextReworkCount,
        matched_rule_type: input.matchedRuleType ?? null,
        requires_human_approval:
          typeof input.requiresHumanApproval === 'boolean'
            ? input.requiresHumanApproval
            : null,
        satisfied_assessment_expectation:
          typeof input.satisfiedAssessmentExpectation === 'boolean'
            ? input.satisfiedAssessmentExpectation
            : null,
        rework_delta: typeof input.reworkDelta === 'number' ? input.reworkDelta : null,
        status_summary: input.statusSummary ?? null,
        next_expected_event: input.nextExpectedEvent ?? null,
        blocked_on: Array.isArray(input.blockedOn) ? input.blockedOn : null,
        active_subordinate_tasks:
          Array.isArray(input.activeSubordinateTasks) ? input.activeSubordinateTasks : null,
        safetynet_behavior_id: input.safetynetBehaviorId ?? null,
      },
      workflowId: readOptionalString(input.task.workflow_id),
      taskId: readOptionalString(input.task.id),
      workItemId: readOptionalString(input.task.work_item_id),
      stageName: input.stageName,
      isOrchestratorTask: readOptionalBoolean(input.task.is_orchestrator_task),
      taskTitle: readOptionalString(input.task.title),
      role: readOptionalString(input.task.role),
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      resourceType: 'work_item',
      resourceId: readOptionalString(input.task.work_item_id),
      resourceName: readOptionalString(input.task.title),
    });
  } catch {
    return;
  }
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
