import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError, ValidationError } from '../../errors/domain-errors.js';
import type { LogService } from '../../logging/execution/log-service.js';
import { logPredecessorHandoffResolution } from '../../logging/workflow-events/predecessor-handoff-log.js';
import { resolveRelevantHandoffs } from './predecessor-handoff-resolver.js';
import type { EventService } from '../event/event-service.js';
import type { WorkflowTaskDeliverablePromotionService } from '../workflow-deliverables/workflow-task-deliverable-promotion-service.js';
import type { ImmediateWorkflowActivationDispatcher } from '../workflow-activation/workflow-immediate-activation.js';
import { taskRequiresStructuredHandoff } from '../workflow-task-policy/workflow-task-handoff-policy.js';
import {
  assertHandoffStateAllowed,
  assertMatchingTaskAttempt,
  buildNormalizedHandoffPayload,
} from './handoff-service.domain.js';
import {
  buildReplayConflictError,
  canReuseCurrentTaskAttemptAfterEarlierAttemptReplay,
  canReusePersistedTaskAttemptHandoff,
  logCurrentAttemptReplayRepair,
  matchesHandoffReplay,
} from './handoff-service.replay.js';
import {
  enqueueWorkflowActivation,
  loadExistingHandoff,
  loadNextSequence,
  loadTask,
  loadTaskAttemptHandoff,
  logSubmittedTaskHandoff,
  promoteTaskDeliverable,
  updateExistingHandoff,
} from './handoff-service.persistence.js';
import {
  readInteger,
  readOptionalString,
  isEditableTaskState,
  toTaskHandoffResponse,
} from './handoff-service.response.js';
import type {
  SubmitTaskHandoffInput,
  TaskHandoffRow,
} from './handoff-service.types.js';

export class HandoffService {
  constructor(
    readonly pool: DatabasePool,
    readonly logService?: LogService,
    readonly eventService?: EventService,
    readonly activationDispatchService?: ImmediateWorkflowActivationDispatcher,
    readonly deliverablePromotionService?: Pick<WorkflowTaskDeliverablePromotionService, 'promoteFromHandoff'>,
  ) {}

  async assertRequiredTaskHandoffBeforeCompletion(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    if (!taskRequiresStructuredHandoff(task)) {
      return;
    }

    const taskId = readOptionalString(task.id);
    if (!taskId) {
      return;
    }

    const taskReworkCount = readInteger(task.rework_count) ?? 0;
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM task_handoffs
        WHERE tenant_id = $1
          AND task_id = $2
          AND task_rework_count = $3
        LIMIT 1`,
      [tenantId, taskId, taskReworkCount],
    );
    if ((result.rowCount ?? 0) > 0) {
      return;
    }

    throw new ValidationError('Task requires a structured handoff before completion', {
      reason_code: 'required_structured_handoff',
      recoverable: true,
      recovery_hint: 'submit_required_handoff',
      recovery: {
        status: 'action_required',
        reason: 'required_structured_handoff',
        action: 'submit_required_handoff',
      },
    });
  }

  async submitTaskHandoff(
    tenantId: string,
    taskId: string,
    input: SubmitTaskHandoffInput,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    if (!input.summary.trim()) {
      throw new ValidationError('summary is required');
    }

    const task = await loadTask(tenantId, taskId, db);
    if (!task.workflow_id) {
      throw new ValidationError('Task must belong to a workflow to submit a handoff');
    }

    assertMatchingTaskAttempt(task, input);
    const payload = buildNormalizedHandoffPayload(task, input);
    assertHandoffStateAllowed(task, payload);

    const replayMatch = await loadExistingHandoff(
      tenantId,
      task.workflow_id,
      payload.request_id,
      db,
    );
    let existingTaskAttempt =
      replayMatch
      && replayMatch.task_id === taskId
      && replayMatch.task_rework_count === payload.task_rework_count
        ? replayMatch
        : null;

    if (replayMatch) {
      if (matchesHandoffReplay(replayMatch, payload) || canReusePersistedTaskAttemptHandoff(task, replayMatch, payload)) {
        await promoteTaskDeliverable(this, tenantId, toTaskHandoffResponse(replayMatch));
        return toTaskHandoffResponse(replayMatch);
      }
      if (!existingTaskAttempt) {
        existingTaskAttempt = await loadTaskAttemptHandoff(
          tenantId,
          taskId,
          payload.task_rework_count,
          db,
        );
      }
      if (
        existingTaskAttempt
        && existingTaskAttempt.id !== replayMatch.id
        && (
          matchesHandoffReplay(existingTaskAttempt, payload)
          || canReuseCurrentTaskAttemptAfterEarlierAttemptReplay(
            task,
            replayMatch,
            existingTaskAttempt,
            payload,
          )
          || canReusePersistedTaskAttemptHandoff(task, existingTaskAttempt, payload)
        )
      ) {
        logCurrentAttemptReplayRepair(task, existingTaskAttempt, replayMatch, payload);
        await promoteTaskDeliverable(this, tenantId, toTaskHandoffResponse(existingTaskAttempt));
        return toTaskHandoffResponse(existingTaskAttempt);
      }
      throw buildReplayConflictError(
        task,
        replayMatch,
        payload,
        existingTaskAttempt && existingTaskAttempt.id !== replayMatch.id ? existingTaskAttempt : null,
      );
    }

    if (!existingTaskAttempt) {
      existingTaskAttempt = await loadTaskAttemptHandoff(
        tenantId,
        taskId,
        payload.task_rework_count,
        db,
      );
    }
    if (existingTaskAttempt) {
      if (matchesHandoffReplay(existingTaskAttempt, payload)) {
        await promoteTaskDeliverable(this, tenantId, toTaskHandoffResponse(existingTaskAttempt));
        return toTaskHandoffResponse(existingTaskAttempt);
      }
      if (!isEditableTaskState(task.state)) {
        if (canReusePersistedTaskAttemptHandoff(task, existingTaskAttempt, payload)) {
          await promoteTaskDeliverable(this, tenantId, toTaskHandoffResponse(existingTaskAttempt));
          return toTaskHandoffResponse(existingTaskAttempt);
        }
        throw buildReplayConflictError(task, existingTaskAttempt, payload, existingTaskAttempt);
      }
      const updated = await updateExistingHandoff(existingTaskAttempt.id, payload, db);
      await promoteTaskDeliverable(this, tenantId, updated);
      await enqueueWorkflowActivation(this, task, payload, db);
      return updated;
    }

    const sequence = await loadNextSequence(tenantId, task.workflow_id, task.work_item_id, db);
    const result = await db.query<TaskHandoffRow>(
      `INSERT INTO task_handoffs (
         tenant_id, workflow_id, work_item_id, task_id, task_rework_count, request_id, role, team_name, stage_name, sequence,
         summary, completion, completion_state, resolution, decision_state, changes, decisions, remaining_items, blockers, focus_areas,
         known_risks, successor_context, role_data, subject_ref, subject_revision, outcome_action_applied, branch_id, artifact_ids,
         recommended_next_actions, waived_steps, completion_callouts
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::text[],
         $21::text[], $22, $23::jsonb, $24::jsonb, $25, $26, $27::uuid, $28::uuid[],
         $29::jsonb, $30::jsonb, $31::jsonb
       )
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        tenantId,
        task.workflow_id,
        task.work_item_id,
        task.id,
        payload.task_rework_count,
        payload.request_id,
        payload.role,
        payload.team_name,
        payload.stage_name,
        sequence,
        payload.summary,
        payload.completion,
        payload.completion_state,
        payload.resolution,
        payload.decision_state,
        JSON.stringify(payload.changes),
        JSON.stringify(payload.decisions),
        JSON.stringify(payload.remaining_items),
        JSON.stringify(payload.blockers),
        payload.focus_areas,
        payload.known_risks,
        payload.successor_context,
        JSON.stringify(payload.role_data),
        JSON.stringify(payload.subject_ref),
        payload.subject_revision,
        payload.outcome_action_applied,
        payload.branch_id,
        payload.artifact_ids,
        JSON.stringify(payload.recommended_next_actions),
        JSON.stringify(payload.waived_steps),
        JSON.stringify(payload.completion_callouts),
      ],
    );
    if (result.rowCount) {
      const handoff = toTaskHandoffResponse(result.rows[0]);
      await promoteTaskDeliverable(this, tenantId, handoff);
      await enqueueWorkflowActivation(this, task, payload, db);
      await logSubmittedTaskHandoff(this, tenantId, task, payload, handoff, db);
      return handoff;
    }

    const existing = await loadTaskAttemptHandoff(tenantId, taskId, payload.task_rework_count, db);
    if (!existing) {
      throw new ConflictError('Task handoff conflicted but no matching row could be loaded');
    }
    if (matchesHandoffReplay(existing, payload)) {
      return toTaskHandoffResponse(existing);
    }
    if (!isEditableTaskState(task.state)) {
      if (canReusePersistedTaskAttemptHandoff(task, existing, payload)) {
        await promoteTaskDeliverable(this, tenantId, toTaskHandoffResponse(existing));
        return toTaskHandoffResponse(existing);
      }
      throw buildReplayConflictError(task, existing, payload);
    }
    const updated = await updateExistingHandoff(existing.id, payload, db);
    await promoteTaskDeliverable(this, tenantId, updated);
    await enqueueWorkflowActivation(this, task, payload, db);
    await logSubmittedTaskHandoff(this, tenantId, task, payload, updated, db);
    return updated;
  }

  async listWorkItemHandoffs(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const result = await db.query<TaskHandoffRow>(
      `SELECT *
         FROM task_handoffs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
        ORDER BY sequence ASC, created_at ASC`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows.map(toTaskHandoffResponse);
  }

  async getLatestWorkItemHandoff(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const result = await db.query<TaskHandoffRow>(
      `SELECT *
         FROM task_handoffs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
        ORDER BY sequence DESC, created_at DESC
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows[0] ? toTaskHandoffResponse(result.rows[0]) : null;
  }

  async getPredecessorHandoff(
    tenantId: string,
    taskId: string,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const task = await loadTask(tenantId, taskId, db);
    const resolution = await resolveRelevantHandoffs(
      db,
      tenantId,
      task as unknown as Record<string, unknown>,
      1,
    );
    await logPredecessorHandoffResolution(this.logService, {
      tenantId,
      operation: 'task.predecessor_handoff.lookup',
      task: task as unknown as Record<string, unknown>,
      resolution,
    });
    const handoff = resolution.handoffs[0] ?? null;
    return handoff ? toTaskHandoffResponse(handoff as TaskHandoffRow) : null;
  }
}
