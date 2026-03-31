import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { LogService } from '../../logging/log-service.js';
import { logWorkItemContinuityTransition } from '../../logging/work-item-continuity-log.js';
import type {
  OrchestratorFinishStateUpdate,
  WorkItemContinuityContextRow,
} from './types.js';
import {
  hasNewerSpecialistHandoffSinceActivation,
  loadContext,
  loadCurrentFinishState,
} from './query-helpers.js';
import {
  compactRecord,
  normalizeStringList,
  readCheckpointName,
  readFinishStateContinuity,
  readOptionalString,
} from './value-helpers.js';

export async function clearAssessmentExpectationState(
  logService: LogService | undefined,
  tenantId: string,
  task: Record<string, unknown>,
  db: DatabaseClient | DatabasePool,
) {
  const context = await loadContext(tenantId, task, db);
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

  await logWorkItemContinuityTransition(logService, {
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

export async function persistOrchestratorFinishStateState(
  logService: LogService | undefined,
  tenantId: string,
  task: Record<string, unknown>,
  update: OrchestratorFinishStateUpdate,
  db: DatabaseClient | DatabasePool,
) {
  const workflowId = readOptionalString(task.workflow_id);
  const workItemId = readOptionalString(task.work_item_id);
  if (!workflowId || !workItemId) {
    return null;
  }

  const current = await loadCurrentFinishState(tenantId, workflowId, workItemId, db);
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
    await hasNewerSpecialistHandoffSinceActivation(
      tenantId,
      workflowId,
      workItemId,
      current.parent_work_item_id,
      readOptionalString(task.activation_id),
      db,
    )
  ) {
    await logWorkItemContinuityTransition(logService, {
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
      safetynetBehaviorId: 'platform.continuity.stale_write_suppression',
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
  await logWorkItemContinuityTransition(logService, {
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
