import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError, NotFoundError } from '../../errors/domain-errors.js';
import type { LogService } from '../../logging/execution/log-service.js';
import { logTaskGovernanceTransition } from '../../logging/workflow-events/task-governance-log.js';
import type { EventService } from '../event/event-service.js';
import type { WorkflowTaskDeliverablePromotionService } from '../workflow-deliverables/workflow-task-deliverable-promotion-service.js';
import {
  enqueueAndDispatchImmediatePlaybookActivation,
  type ImmediateWorkflowActivationDispatcher,
} from '../workflow-activation/workflow-immediate-activation.js';
import type {
  SubmitTaskHandoffInput,
  TaskContextRow,
  TaskHandoffRow,
} from './handoff-service.types.js';
import {
  normalizeRecord,
  readInteger,
  readOptionalString,
  serializeJsonb,
  toTaskHandoffResponse,
} from './handoff-service.response.js';
import { applyActivationEventAnchor, buildNormalizedHandoffPayload } from './handoff-service.domain.js';

export interface HandoffServiceContext {
  pool: DatabasePool;
  logService?: LogService;
  eventService?: EventService;
  activationDispatchService?: ImmediateWorkflowActivationDispatcher;
  deliverablePromotionService?: Pick<WorkflowTaskDeliverablePromotionService, 'promoteFromHandoff'>;
}

export async function promoteTaskDeliverable(
  service: HandoffServiceContext,
  tenantId: string,
  handoff: ReturnType<typeof toTaskHandoffResponse>,
): Promise<void> {
  if (!service.deliverablePromotionService) {
    return;
  }
  await service.deliverablePromotionService.promoteFromHandoff(tenantId, {
    id: handoff.id,
    workflow_id: handoff.workflow_id,
    work_item_id: handoff.work_item_id,
    task_id: handoff.task_id,
    role: handoff.role,
    summary: handoff.summary,
    completion: handoff.completion,
    completion_state: handoff.completion_state,
    role_data: normalizeRecord(handoff.role_data),
    artifact_ids: Array.isArray(handoff.artifact_ids) ? handoff.artifact_ids : [],
    created_at: handoff.created_at,
  });
}

export async function enqueueWorkflowActivation(
  service: HandoffServiceContext,
  task: TaskContextRow,
  payload: ReturnType<typeof buildNormalizedHandoffPayload>,
  db: DatabaseClient | DatabasePool,
) {
  if (!task.workflow_id || !service.eventService || task.is_orchestrator_task) {
    return;
  }

  await enqueueAndDispatchImmediatePlaybookActivation(
    db,
    service.eventService,
    service.activationDispatchService,
    {
      tenantId: task.tenant_id,
      workflowId: task.workflow_id,
      requestId: `task-handoff-submitted:${task.id}:${payload.task_rework_count}:${payload.request_id ?? payload.summary}`,
      reason: 'task.handoff_submitted',
      eventType: 'task.handoff_submitted',
      payload: {
        task_id: task.id,
        work_item_id: task.work_item_id,
        role: task.role,
        stage_name: task.stage_name,
        completion: payload.completion,
        completion_state: payload.completion_state,
        resolution: payload.resolution,
        decision_state: payload.decision_state,
        handoff_request_id: payload.request_id,
      },
      actorType: 'system',
      actorId: 'handoff_service',
    },
  );
}

export async function logSubmittedTaskHandoff(
  service: HandoffServiceContext,
  tenantId: string,
  task: TaskContextRow,
  payload: ReturnType<typeof buildNormalizedHandoffPayload>,
  handoff: Record<string, unknown>,
  db?: DatabaseClient | DatabasePool,
) {
  await logTaskGovernanceTransition(service.logService, {
    tenantId,
    operation: 'task.handoff.submitted',
    executor: db,
    task,
    payload: {
      event_type: 'task.handoff_submitted',
      handoff_id: readOptionalString(handoff.id),
      handoff_request_id: payload.request_id,
      task_rework_count: payload.task_rework_count,
      completion: payload.completion,
      completion_state: payload.completion_state,
      resolution: payload.resolution,
      decision_state: payload.decision_state,
      sequence: readInteger(handoff.sequence),
      artifact_ids: Array.isArray(handoff.artifact_ids) ? handoff.artifact_ids : [],
      recommended_next_actions: Array.isArray(handoff.recommended_next_actions) ? handoff.recommended_next_actions : [],
      waived_steps: Array.isArray(handoff.waived_steps) ? handoff.waived_steps : [],
    },
  });
}

export async function loadTask(
  tenantId: string,
  taskId: string,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<TaskContextRow>(
    `SELECT id, tenant_id, workflow_id, work_item_id, role, stage_name, state, rework_count,
            is_orchestrator_task, input, metadata
       FROM tasks
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    [tenantId, taskId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Task not found');
  }
  return applyActivationEventAnchor(result.rows[0]);
}

export async function loadNextSequence(
  tenantId: string,
  workflowId: string,
  workItemId: string | null,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<{ next_sequence: number }>(
    `SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence
       FROM task_handoffs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND (
          (work_item_id IS NULL AND $3::uuid IS NULL)
          OR work_item_id = $3
        )`,
    [tenantId, workflowId, workItemId],
  );
  return Number(result.rows[0]?.next_sequence ?? 0);
}

export async function loadExistingHandoff(
  tenantId: string,
  workflowId: string,
  requestId: string | null,
  db: DatabaseClient | DatabasePool,
) {
  if (!requestId?.trim()) {
    return null;
  }
  const byRequestId = await db.query<TaskHandoffRow>(
    `SELECT *
       FROM task_handoffs
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND request_id = $3
      LIMIT 1`,
    [tenantId, workflowId, requestId.trim()],
  );
  return byRequestId.rows[0] ?? null;
}

export async function loadTaskAttemptHandoff(
  tenantId: string,
  taskId: string,
  taskReworkCount: number,
  db: DatabaseClient | DatabasePool,
) {
  const byTaskId = await db.query<TaskHandoffRow>(
    `SELECT *
       FROM task_handoffs
      WHERE tenant_id = $1
        AND task_id = $2
        AND task_rework_count = $3
      LIMIT 1`,
    [tenantId, taskId, taskReworkCount],
  );
  return byTaskId.rows[0] ?? null;
}

export async function updateExistingHandoff(
  handoffId: string,
  payload: ReturnType<typeof buildNormalizedHandoffPayload>,
  db: DatabaseClient | DatabasePool,
) {
  const result = await db.query<TaskHandoffRow>(
    `UPDATE task_handoffs
        SET request_id = $2,
            role = $3,
            team_name = $4,
            stage_name = $5,
            summary = $6,
            completion = $7,
            completion_state = $8,
            resolution = $9,
            decision_state = $10,
            changes = $11::jsonb,
            decisions = $12::jsonb,
            remaining_items = $13::jsonb,
            blockers = $14::jsonb,
            focus_areas = $15::text[],
            known_risks = $16::text[],
            successor_context = $17,
            role_data = $18::jsonb,
            subject_ref = $19::jsonb,
            subject_revision = $20,
            outcome_action_applied = $21,
            branch_id = $22::uuid,
            artifact_ids = $23::uuid[],
            recommended_next_actions = $24::jsonb,
            waived_steps = $25::jsonb,
            completion_callouts = $26::jsonb
      WHERE id = $1
      RETURNING *`,
    [
      handoffId,
      payload.request_id,
      payload.role,
      payload.team_name,
      payload.stage_name,
      payload.summary,
      payload.completion,
      payload.completion_state,
      payload.resolution,
      payload.decision_state,
      serializeJsonb(payload.changes),
      serializeJsonb(payload.decisions),
      serializeJsonb(payload.remaining_items),
      serializeJsonb(payload.blockers),
      payload.focus_areas,
      payload.known_risks,
      payload.successor_context,
      serializeJsonb(payload.role_data),
      serializeJsonb(payload.subject_ref),
      payload.subject_revision,
      payload.outcome_action_applied,
      payload.branch_id,
      payload.artifact_ids,
      serializeJsonb(payload.recommended_next_actions),
      serializeJsonb(payload.waived_steps),
      serializeJsonb(payload.completion_callouts),
    ],
  );
  if (!result.rowCount) {
    throw new ConflictError('Task handoff conflicted but could not be updated');
  }
  return toTaskHandoffResponse(result.rows[0]);
}
