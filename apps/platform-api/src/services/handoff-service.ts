import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { LogService } from '../logging/log-service.js';
import { logPredecessorHandoffResolution } from '../logging/predecessor-handoff-log.js';
import { logTaskGovernanceTransition } from '../logging/task-governance-log.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import {
  readAssessmentSubjectLinkage,
  readWorkflowTaskKind,
} from './assessment-subject-service.js';
import {
  completionCalloutsSchema,
  emptyCompletionCallouts,
  guidedClosureSuggestedActionSchema,
  guidedClosureWaivedStepSchema,
} from './guided-closure/types.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { resolveRelevantHandoffs } from './predecessor-handoff-resolver.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';
import {
  PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
  mustGetSafetynetEntry,
} from './safetynet/registry.js';
import { logSafetynetTriggered } from './safetynet/logging.js';
import type { EventService } from './event-service.js';
import type { WorkflowTaskDeliverablePromotionService } from './workflow-task-deliverable-promotion-service.js';
import {
  enqueueAndDispatchImmediatePlaybookActivation,
  type ImmediateWorkflowActivationDispatcher,
} from './workflow-immediate-activation.js';
import { taskRequiresStructuredHandoff } from './workflow-task-handoff-policy.js';

const HANDOFF_SECRET_REDACTION = 'redacted://handoff-secret';
const HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_ID,
);
const TASK_LOCAL_HANDOFF_PATH_PATTERNS = [
  /(?:^|[\s"'`(])(output\/[^\s"'`),\]]+)/i,
  /(?:^|[\s"'`(])(repo\/[^\s"'`),\]]+)/i,
  /(\/tmp\/workspace\/[^\s"'`),\]]+)/i,
];

export interface SubmitTaskHandoffInput {
  request_id?: string;
  task_rework_count?: number;
  summary: string;
  completion?: 'full' | 'blocked';
  completion_state?: 'full' | 'blocked';
  resolution?: 'approved' | 'request_changes' | 'rejected' | 'blocked';
  decision_state?: 'approved' | 'request_changes' | 'rejected' | 'blocked';
  closure_effect?: 'blocking' | 'advisory';
  changes?: unknown[];
  decisions?: unknown[];
  remaining_items?: unknown[];
  blockers?: unknown[];
  focus_areas?: string[];
  known_risks?: string[];
  recommended_next_actions?: unknown[];
  waived_steps?: unknown[];
  completion_callouts?: Record<string, unknown>;
  successor_context?: string;
  role_data?: Record<string, unknown>;
  subject_ref?: Record<string, unknown>;
  subject_revision?: number;
  outcome_action_applied?: 'reopen_subject' | 'route_to_role' | 'block_subject' | 'escalate' | 'terminate_branch';
  branch_id?: string;
  artifact_ids?: string[];
}

type HandoffOutcomeAction =
  | 'reopen_subject'
  | 'route_to_role'
  | 'block_subject'
  | 'escalate'
  | 'terminate_branch';

interface TaskContextRow {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  work_item_id: string | null;
  role: string | null;
  stage_name: string | null;
  state: string | null;
  rework_count: number | null;
  is_orchestrator_task: boolean;
  input: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

interface TaskHandoffRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string;
  task_rework_count: number;
  request_id: string | null;
  role: string;
  team_name: string | null;
  stage_name: string | null;
  sequence: number;
  summary: string;
  completion: string;
  completion_state?: string | null;
  resolution: string | null;
  decision_state?: string | null;
  closure_effect?: string | null;
  changes: unknown[];
  decisions: unknown[];
  remaining_items: unknown[];
  blockers: unknown[];
  focus_areas: string[];
  known_risks: string[];
  recommended_next_actions?: unknown[];
  waived_steps?: unknown[];
  completion_callouts?: Record<string, unknown>;
  successor_context: string | null;
  role_data: Record<string, unknown>;
  subject_ref?: Record<string, unknown> | null;
  subject_revision?: number | null;
  outcome_action_applied?: string | null;
  branch_id?: string | null;
  artifact_ids: string[];
  created_at: Date;
}

export class HandoffService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly logService?: LogService,
    private readonly eventService?: EventService,
    private readonly activationDispatchService?: ImmediateWorkflowActivationDispatcher,
    private readonly deliverablePromotionService?: Pick<WorkflowTaskDeliverablePromotionService, 'promoteFromHandoff'>,
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

    const task = await this.loadTask(tenantId, taskId, db);
    if (!task.workflow_id) {
      throw new ValidationError('Task must belong to a workflow to submit a handoff');
    }

    assertMatchingTaskAttempt(task, input);
    const payload = buildNormalizedHandoffPayload(task, input);
    assertHandoffStateAllowed(task, payload);
    const replayMatch = await this.loadExistingHandoff(
      tenantId,
      task.workflow_id,
      payload.request_id,
      db,
    );
    if (replayMatch) {
      assertMatchingHandoffReplay(replayMatch, payload);
      await this.promoteTaskDeliverable(tenantId, toTaskHandoffResponse(replayMatch));
      return toTaskHandoffResponse(replayMatch);
    }

    const existingTaskAttempt = await this.loadTaskAttemptHandoff(
      tenantId,
      taskId,
      payload.task_rework_count,
      db,
    );
    if (existingTaskAttempt) {
      if (matchesHandoffReplay(existingTaskAttempt, payload)) {
        await this.promoteTaskDeliverable(tenantId, toTaskHandoffResponse(existingTaskAttempt));
        return toTaskHandoffResponse(existingTaskAttempt);
      }
      if (!isEditableTaskState(task.state)) {
        throw new ConflictError('task handoff request replay does not match the existing handoff');
      }
      const updated = await this.updateExistingHandoff(existingTaskAttempt.id, payload, db);
      await this.promoteTaskDeliverable(tenantId, updated);
      await this.enqueueWorkflowActivation(task, payload, db);
      return updated;
    }

    const sequence = await this.loadNextSequence(tenantId, task.workflow_id, task.work_item_id, db);
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
    if (result.rowCount) {
      const handoff = toTaskHandoffResponse(result.rows[0]);
      await this.promoteTaskDeliverable(tenantId, handoff);
      await this.enqueueWorkflowActivation(task, payload, db);
      await this.logSubmittedTaskHandoff(tenantId, task, payload, handoff, db);
      return handoff;
    }

    const existing = await this.loadTaskAttemptHandoff(tenantId, taskId, payload.task_rework_count, db);
    if (!existing) {
      throw new ConflictError('Task handoff conflicted but no matching row could be loaded');
    }
    if (matchesHandoffReplay(existing, payload)) {
      return toTaskHandoffResponse(existing);
    }
    if (!isEditableTaskState(task.state)) {
      throw new ConflictError('task handoff request replay does not match the existing handoff');
    }
    const updated = await this.updateExistingHandoff(existing.id, payload, db);
    await this.promoteTaskDeliverable(tenantId, updated);
    await this.enqueueWorkflowActivation(task, payload, db);
    await this.logSubmittedTaskHandoff(tenantId, task, payload, updated, db);
    return updated;
  }

  private async promoteTaskDeliverable(
    tenantId: string,
    handoff: ReturnType<typeof toTaskHandoffResponse>,
  ): Promise<void> {
    if (!this.deliverablePromotionService) {
      return;
    }
    await this.deliverablePromotionService.promoteFromHandoff(tenantId, {
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

  private async enqueueWorkflowActivation(
    task: TaskContextRow,
    payload: ReturnType<typeof buildNormalizedHandoffPayload>,
    db: DatabaseClient | DatabasePool,
  ) {
    if (!task.workflow_id || !this.eventService || task.is_orchestrator_task) {
      return;
    }

    await enqueueAndDispatchImmediatePlaybookActivation(
      db,
      this.eventService,
      this.activationDispatchService,
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

  private async logSubmittedTaskHandoff(
    tenantId: string,
    task: TaskContextRow,
    payload: ReturnType<typeof buildNormalizedHandoffPayload>,
    handoff: Record<string, unknown>,
    db?: DatabaseClient | DatabasePool,
  ) {
    await logTaskGovernanceTransition(this.logService, {
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

  async getPredecessorHandoff(
    tenantId: string,
    taskId: string,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const task = await this.loadTask(tenantId, taskId, db);
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

  private async loadTask(
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

  private async loadWorkflowPlaybookDefinition(
    tenantId: string,
    workflowId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<{ definition: unknown }>(
      `SELECT pb.definition
         FROM workflows w
         JOIN playbooks pb
           ON pb.tenant_id = w.tenant_id
          AND pb.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        LIMIT 1`,
      [tenantId, workflowId],
    );
    const definitionValue = result.rows[0]?.definition;
    if (!definitionValue) {
      return null;
    }
    return parsePlaybookDefinition(definitionValue);
  }

  private async loadNextSequence(
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

  private async loadExistingHandoff(
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

  private async loadTaskAttemptHandoff(
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

  private async updateExistingHandoff(
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
}

function assertHandoffStateAllowed(
  task: TaskContextRow,
  payload: ReturnType<typeof buildNormalizedHandoffPayload>,
) {
  if (!allowsHandoffResolution(task)) {
    if (!payload.decision_state && !payload.outcome_action_applied && !payload.closure_effect) {
      return;
    }
    throw new ValidationError('resolution, outcome_action_applied, and closure_effect are only allowed on assessment or approval handoffs');
  }
  if (payload.completion_state === 'full' && !payload.decision_state) {
    throw new ValidationError('resolution is required on full assessment or approval handoffs');
  }
  if (payload.completion_state === 'blocked' && payload.decision_state) {
    throw new ValidationError('decision_state is only allowed when completion_state is full');
  }
  if (payload.completion_state !== 'full' && (payload.outcome_action_applied || payload.closure_effect)) {
    throw new ValidationError('outcome_action_applied and closure_effect are only allowed when completion_state is full');
  }
}

function buildNormalizedHandoffPayload(task: TaskContextRow, input: SubmitTaskHandoffInput) {
  const taskReworkCount = input.task_rework_count ?? readInteger(task.rework_count) ?? 0;
  const summary = sanitizeHandoffValue(input.summary.trim());
  const state = normalizeHandoffStates(input);
  const branchId = normalizeUUIDString(input.branch_id ?? input.role_data?.branch_id ?? task.metadata?.branch_id);
  const roleData = buildSystemOwnedRoleData(task, input, branchId);
  const subjectRef = resolveSubjectRef(input, roleData, branchId);
  const subjectRevision = resolveSubjectRevision(input, roleData);
  const payload = {
    task_rework_count: taskReworkCount,
    request_id: input.request_id?.trim() || null,
    role: task.role?.trim() || 'specialist',
    team_name: readOptionalString(task.metadata?.team_name),
    stage_name: task.stage_name?.trim() || null,
    summary: typeof summary === 'string' ? summary : input.summary.trim(),
    completion: state.completion_state,
    completion_state: state.completion_state,
    resolution: state.decision_state,
    decision_state: state.decision_state,
    closure_effect: normalizeClosureEffect(input.closure_effect ?? input.role_data?.closure_effect),
    changes: normalizeArray(sanitizeHandoffValue(input.changes)),
    decisions: normalizeArray(sanitizeHandoffValue(input.decisions)),
    remaining_items: normalizeArray(sanitizeHandoffValue(input.remaining_items)),
    blockers: normalizeArray(sanitizeHandoffValue(input.blockers)),
    focus_areas: normalizeStringArray(sanitizeHandoffValue(input.focus_areas)),
    known_risks: normalizeStringArray(sanitizeHandoffValue(input.known_risks)),
    recommended_next_actions: normalizeRecommendedNextActions(input.recommended_next_actions),
    waived_steps: normalizeWaivedSteps(input.waived_steps, input.completion_callouts),
    completion_callouts: normalizeCompletionCallouts(input.completion_callouts, input.waived_steps),
    successor_context: readOptionalString(sanitizeHandoffValue(input.successor_context)),
    role_data: roleData,
    subject_ref: subjectRef,
    subject_revision: subjectRevision,
    outcome_action_applied: normalizeOutcomeActionApplied(input.outcome_action_applied),
    branch_id: branchId,
    artifact_ids: normalizeStringArray(input.artifact_ids),
  };
  const repairedPayload = normalizeTaskLocalHandoffReferences(payload);
  if (repairedPayload.wasRepaired) {
    logSafetynetTriggered(
      HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET,
      'task-local handoff references repaired to stable operator-facing references',
      { task_id: task.id, workflow_id: task.workflow_id },
    );
  }
  assertNoTaskLocalHandoffPaths(repairedPayload.payload);
  return repairedPayload.payload;
}

function applyActivationEventAnchor(task: TaskContextRow): TaskContextRow {
  if (task.work_item_id) {
    return task;
  }
  const activationAnchor = readActivationEventAnchor(task.input);
  if (!activationAnchor.work_item_id && !activationAnchor.stage_name) {
    return task;
  }
  return {
    ...task,
    work_item_id: activationAnchor.work_item_id ?? task.work_item_id,
    stage_name: activationAnchor.stage_name ?? task.stage_name,
  };
}

function readActivationEventAnchor(input: Record<string, unknown> | null | undefined) {
  const events = Array.isArray(input?.events) ? input.events : [];
  for (const entry of events) {
    const event = normalizeRecord(entry);
    const payload = normalizeRecord(event.payload);
    const workItemId = readOptionalString(event.work_item_id) ?? readOptionalString(payload.work_item_id);
    const stageName = readOptionalString(event.stage_name) ?? readOptionalString(payload.stage_name);
    if (!workItemId && !stageName) {
      continue;
    }
    return {
      work_item_id: workItemId ?? null,
      stage_name: stageName ?? null,
    };
  }
  return {
    work_item_id: null,
    stage_name: null,
  };
}

function assertMatchingTaskAttempt(task: TaskContextRow, input: SubmitTaskHandoffInput) {
  if (input.task_rework_count === undefined) {
    return;
  }
  const currentTaskReworkCount = readInteger(task.rework_count) ?? 0;
  if (input.task_rework_count === currentTaskReworkCount) {
    return;
  }
  throw new ConflictError('task handoff submission does not match the current task rework attempt');
}

function buildSystemOwnedRoleData(
  task: TaskContextRow,
  input: SubmitTaskHandoffInput,
  branchId: string | null,
) {
  const taskKind = readWorkflowTaskKind(task.metadata, task.is_orchestrator_task);
  const roleData = sanitizeHandoffRecord(input.role_data);
  const closureEffect = normalizeClosureEffect(input.closure_effect ?? roleData.closure_effect);

  if (taskKind === 'delivery') {
    const persistedRevision = readInteger(normalizeRecord(task.metadata).output_revision) ?? 0;
    const reworkDerivedRevision = (readInteger(task.rework_count) ?? 0) + 1;
    const inputRevision =
      readOptionalPositiveInteger(input.subject_revision)
      ?? readOptionalPositiveInteger(task.input?.subject_revision);
    const subjectRevision = Math.max(persistedRevision, reworkDerivedRevision, inputRevision ?? 0);
    const normalized = sanitizeHandoffRecord({
      ...roleData,
      task_kind: taskKind,
      ...(closureEffect ? { closure_effect: closureEffect } : {}),
      subject_task_id: task.id,
      ...(task.work_item_id ? { subject_work_item_id: task.work_item_id } : {}),
      ...(subjectRevision > 0 ? { subject_revision: subjectRevision } : {}),
      ...(branchId ? { branch_id: branchId } : {}),
    });
    if (!areJsonValuesEquivalent(roleData, normalized)) {
      logSafetynetTriggered(
        HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET,
        'delivery handoff role_data normalized with system-owned linkage',
        { task_id: task.id, workflow_id: task.workflow_id },
      );
    }
    return normalized;
  }

  const linkage = readAssessmentSubjectLinkage(task.input, task.metadata);
  const normalized = sanitizeHandoffRecord({
    ...roleData,
    task_kind: taskKind,
    ...(closureEffect ? { closure_effect: closureEffect } : {}),
    ...(linkage.subjectTaskId ? { subject_task_id: linkage.subjectTaskId } : {}),
    ...(linkage.subjectWorkItemId ? { subject_work_item_id: linkage.subjectWorkItemId } : {}),
    ...(linkage.subjectHandoffId ? { subject_handoff_id: linkage.subjectHandoffId } : {}),
    ...(linkage.subjectRevision !== null ? { subject_revision: linkage.subjectRevision } : {}),
    ...(branchId ? { branch_id: branchId } : {}),
  });
  if (!areJsonValuesEquivalent(roleData, normalized)) {
    logSafetynetTriggered(
      HANDOFF_NORMALIZATION_AND_REPLAY_REPAIR_SAFETYNET,
      'assessment or approval handoff role_data normalized with subject linkage',
      { task_id: task.id, workflow_id: task.workflow_id },
    );
  }
  return normalized;
}

function assertMatchingHandoffReplay(
  existing: TaskHandoffRow,
  expected: ReturnType<typeof buildNormalizedHandoffPayload>,
) {
  if (!matchesHandoffReplay(existing, expected)) {
    throw new ConflictError('task handoff request replay does not match the existing handoff');
  }
}

function matchesHandoffReplay(
  existing: TaskHandoffRow,
  expected: ReturnType<typeof buildNormalizedHandoffPayload>,
) {
  const existingRoleData = normalizeRecord(existing.role_data);
  const existingBranchId =
    normalizeUUIDString(existing.branch_id)
    ?? normalizeUUIDString(existingRoleData.branch_id);
  const existingSubjectRef =
    sanitizeNullableSubjectRef(existing.subject_ref)
    ?? deriveSubjectRef(existingRoleData, existingBranchId);
  const existingSubjectRevision =
    readOptionalPositiveInteger(existing.subject_revision)
    ?? readOptionalPositiveInteger(existingRoleData.subject_revision);

  return !(
    existing.role !== expected.role ||
    (existing.team_name ?? null) !== expected.team_name ||
    (existing.stage_name ?? null) !== expected.stage_name ||
    existing.summary !== expected.summary ||
    normalizeCompletionState(existing.completion_state ?? existing.completion) !== expected.completion_state ||
    normalizeHandoffResolution(existing.decision_state ?? existing.resolution) !== expected.decision_state ||
    !areJsonValuesEquivalent(existing.changes, expected.changes) ||
    !areJsonValuesEquivalent(existing.decisions, expected.decisions) ||
    !areJsonValuesEquivalent(existing.remaining_items, expected.remaining_items) ||
    !areJsonValuesEquivalent(existing.blockers, expected.blockers) ||
    !areJsonValuesEquivalent(existing.focus_areas, expected.focus_areas) ||
    !areJsonValuesEquivalent(existing.known_risks, expected.known_risks) ||
    !areJsonValuesEquivalent(existing.recommended_next_actions ?? [], expected.recommended_next_actions) ||
    !areJsonValuesEquivalent(existing.waived_steps ?? [], expected.waived_steps) ||
    !areJsonValuesEquivalent(existing.completion_callouts ?? emptyCompletionCallouts(), expected.completion_callouts) ||
    (existing.successor_context ?? null) !== expected.successor_context ||
    !areJsonValuesEquivalent(existing.role_data, expected.role_data) ||
    !areJsonValuesEquivalent(existingSubjectRef, expected.subject_ref ?? null) ||
    existingSubjectRevision !== expected.subject_revision ||
    (existing.outcome_action_applied ?? null) !== expected.outcome_action_applied ||
    existingBranchId !== expected.branch_id ||
    !areJsonValuesEquivalent(existing.artifact_ids, expected.artifact_ids)
  );
}

function normalizeHandoffResolution(
  value: unknown,
): 'approved' | 'request_changes' | 'rejected' | 'blocked' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'approved'
    || normalized === 'request_changes'
    || normalized === 'rejected'
    || normalized === 'blocked'
    ? normalized
    : null;
}

function allowsHandoffResolution(task: TaskContextRow) {
  const taskKind = readWorkflowTaskKind(task.metadata, task.is_orchestrator_task);
  return taskKind === 'assessment' || taskKind === 'approval';
}

function normalizeHandoffStates(input: SubmitTaskHandoffInput) {
  const completion = normalizeCompletionState(input.completion);
  const completionState = normalizeCompletionState(input.completion_state);
  const resolution = normalizeHandoffResolution(input.resolution ?? input.role_data?.resolution);
  const decisionState = normalizeHandoffResolution(input.decision_state ?? input.role_data?.decision_state);

  if (completion && completionState && completion !== completionState) {
    throw new ValidationError(
      'completion/completion_state and resolution/decision_state must agree when both are provided',
    );
  }
  if (resolution && decisionState && resolution !== decisionState) {
    throw new ValidationError(
      'completion/completion_state and resolution/decision_state must agree when both are provided',
    );
  }

  const normalizedCompletion = completionState ?? completion;
  if (!normalizedCompletion) {
    throw new ValidationError('completion or completion_state is required');
  }

  return {
    completion_state: normalizedCompletion,
    decision_state: decisionState ?? resolution,
  };
}

function normalizeCompletionState(value: unknown): 'full' | 'blocked' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'full' || normalized === 'blocked' ? normalized : null;
}

function normalizeOutcomeActionApplied(value: unknown): HandoffOutcomeAction | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'reopen_subject'
    || normalized === 'route_to_role'
    || normalized === 'block_subject'
    || normalized === 'escalate'
    || normalized === 'terminate_branch'
  ) {
    return normalized;
  }
  throw new ValidationError(
    'outcome_action_applied must be omitted for ordinary continuation; use it only for reopen_subject, route_to_role, block_subject, escalate, or terminate_branch',
  );
}

function normalizeClosureEffect(value: unknown): 'blocking' | 'advisory' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'blocking' || normalized === 'advisory' ? normalized : null;
}

function resolveSubjectRef(
  input: SubmitTaskHandoffInput,
  roleData: Record<string, unknown>,
  branchId: string | null,
) {
  const explicit = sanitizeNullableSubjectRef(input.subject_ref);
  const derived = deriveSubjectRef(roleData, branchId);
  if (explicit && derived && !areJsonValuesEquivalent(explicit, derived)) {
    throw new ValidationError('subject_ref must match the task-linked subject metadata');
  }
  return explicit ?? derived;
}

function deriveSubjectRef(roleData: Record<string, unknown>, branchId: string | null) {
  if (branchId) {
    return compactRecord({
      kind: 'branch',
      branch_id: branchId,
      task_id: readOptionalString(roleData.subject_task_id),
      work_item_id: readOptionalString(roleData.subject_work_item_id),
      handoff_id: readOptionalString(roleData.subject_handoff_id),
    });
  }

  const taskId = readOptionalString(roleData.subject_task_id);
  const workItemId = readOptionalString(roleData.subject_work_item_id);
  const handoffId = readOptionalString(roleData.subject_handoff_id);
  if (taskId) {
    return compactRecord({
      kind: 'task',
      task_id: taskId,
      work_item_id: workItemId,
      handoff_id: handoffId,
    });
  }
  if (workItemId) {
    return compactRecord({
      kind: 'work_item',
      work_item_id: workItemId,
      handoff_id: handoffId,
    });
  }
  if (handoffId) {
    return { kind: 'handoff', handoff_id: handoffId };
  }
  return null;
}

function sanitizeNullableSubjectRef(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return sanitizeHandoffRecord(value);
}

function normalizeUUIDString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveSubjectRevision(
  input: SubmitTaskHandoffInput,
  roleData: Record<string, unknown>,
) {
  const explicit = readOptionalPositiveInteger(input.subject_revision);
  const derived = readOptionalPositiveInteger(roleData.subject_revision);
  if (explicit !== null && derived !== null && explicit !== derived) {
    throw new ValidationError('subject_revision must match the task-linked subject metadata');
  }
  return explicit ?? derived;
}

function toTaskHandoffResponse(row: TaskHandoffRow) {
  const sanitized = sanitizeHandoffValue(row) as TaskHandoffRow;
  const roleData = normalizeRecord(sanitized.role_data);
  const branchId =
    normalizeUUIDString(sanitized.branch_id)
    ?? normalizeUUIDString(roleData.branch_id);
  return {
    ...sanitized,
    completion_state: normalizeCompletionState(sanitized.completion_state ?? sanitized.completion),
    decision_state: normalizeHandoffResolution(sanitized.decision_state ?? sanitized.resolution),
    subject_ref:
      sanitizeNullableSubjectRef(sanitized.subject_ref)
      ?? deriveSubjectRef(roleData, branchId),
    subject_revision:
      readOptionalPositiveInteger(sanitized.subject_revision)
      ?? readOptionalPositiveInteger(roleData.subject_revision),
    outcome_action_applied: readOptionalString(sanitized.outcome_action_applied),
    closure_effect: normalizeClosureEffect(roleData.closure_effect),
    branch_id: branchId,
    recommended_next_actions: normalizeArray(sanitized.recommended_next_actions),
    waived_steps: normalizeArray(sanitized.waived_steps),
    completion_callouts: completionCalloutsSchema.parse(sanitized.completion_callouts ?? {}),
    created_at: row.created_at.toISOString(),
  };
}

function sanitizeHandoffValue(value: unknown): unknown {
  return sanitizeSecretLikeValue(value, {
    redactionValue: HANDOFF_SECRET_REDACTION,
  });
}

function sanitizeHandoffRecord(value: unknown): Record<string, unknown> {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: HANDOFF_SECRET_REDACTION,
  });
}

function normalizeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function normalizeRecommendedNextActions(value: unknown) {
  return guidedClosureSuggestedActionSchema.array().max(100).parse(normalizeArray(sanitizeHandoffValue(value)));
}

function normalizeWaivedSteps(value: unknown, completionCallouts: unknown) {
  const explicit = guidedClosureWaivedStepSchema.array().max(100).parse(normalizeArray(sanitizeHandoffValue(value)));
  if (explicit.length > 0) {
    return explicit;
  }
  return completionCalloutsSchema.parse(sanitizeHandoffValue(completionCallouts ?? {})).waived_steps;
}

function normalizeCompletionCallouts(value: unknown, waivedSteps: unknown) {
  const parsed = completionCalloutsSchema.parse(sanitizeHandoffValue(value ?? {}));
  const explicitWaivedSteps = guidedClosureWaivedStepSchema.array().max(100).safeParse(
    normalizeArray(sanitizeHandoffValue(waivedSteps)),
  );
  if (!explicitWaivedSteps.success || explicitWaivedSteps.data.length === 0) {
    return parsed;
  }
  return completionCalloutsSchema.parse({
    ...parsed,
    waived_steps: explicitWaivedSteps.data,
  });
}

function normalizeRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as T;
}

function readOptionalPositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function assertNoTaskLocalHandoffPaths(value: unknown) {
  const offendingPath = findTaskLocalHandoffPath(value);
  if (!offendingPath) {
    return;
  }
  throw new ValidationError(
    `Structured handoffs must not reference task-local path "${offendingPath}". Persist output to artifacts/repo/memory and reference artifact ids/logical paths, repo-relative paths, memory keys, and workflow/task ids instead`,
  );
}

function normalizeTaskLocalHandoffReferences<T extends Record<string, unknown>>(
  payload: T,
): {
  payload: T;
  wasRepaired: boolean;
} {
  const artifactIds = Array.isArray(payload.artifact_ids) ? payload.artifact_ids : [];
  const canRepairOutputPath = artifactIds.length > 0 || containsStableArtifactLogicalPath(payload);
  const normalization = normalizeTaskLocalHandoffValue(payload, canRepairOutputPath);
  return {
    payload: normalization.value as T,
    wasRepaired: normalization.wasRepaired,
  };
}

function containsStableArtifactLogicalPath(value: unknown): boolean {
  if (typeof value === 'string') {
    return /\bartifact:[^\s"'`),\]]+/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsStableArtifactLogicalPath(entry));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some((entry) => containsStableArtifactLogicalPath(entry));
}

function normalizeTaskLocalHandoffValue(
  value: unknown,
  canRepairOutputPath: boolean,
): {
  value: unknown;
  wasRepaired: boolean;
} {
  if (typeof value === 'string') {
    return normalizeTaskLocalHandoffText(value, canRepairOutputPath);
  }
  if (Array.isArray(value)) {
    let wasRepaired = false;
    const next = value.map((entry) => {
      const normalized = normalizeTaskLocalHandoffValue(entry, canRepairOutputPath);
      wasRepaired = wasRepaired || normalized.wasRepaired;
      return normalized.value;
    });
    return { value: next, wasRepaired };
  }
  if (!value || typeof value !== 'object') {
    return { value, wasRepaired: false };
  }
  let wasRepaired = false;
  const next = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const normalized = normalizeTaskLocalHandoffValue(entry, canRepairOutputPath);
      wasRepaired = wasRepaired || normalized.wasRepaired;
      return [key, normalized.value];
    }),
  );
  return { value: next, wasRepaired };
}

function normalizeTaskLocalHandoffText(
  text: string,
  canRepairOutputPath: boolean,
): {
  value: string;
  wasRepaired: boolean;
} {
  let wasRepaired = false;
  let value = text.replace(
    /(^|[\s"'`(])\/tmp\/workspace\/repo\/([^\s"'`),\]]+)/gi,
    (_match, prefix: string, repoPath: string) => {
      wasRepaired = true;
      return `${prefix}${repoPath}`;
    },
  );
  value = value.replace(
    /(^|[\s"'`(])repo\/([^\s"'`),\]]+)/gi,
    (_match, prefix: string, repoPath: string) => {
      wasRepaired = true;
      return `${prefix}${repoPath}`;
    },
  );
  if (!canRepairOutputPath) {
    return { value, wasRepaired };
  }
  value = value.replace(
    /(^|[\s"'`(])(?:\/tmp\/workspace\/)?output\/([^\s"'`),\]]+)/gi,
    (_match, prefix: string, outputPath: string) => {
      wasRepaired = true;
      return `${prefix}uploaded artifact ${outputPath}`;
    },
  );
  return { value, wasRepaired };
}

function findTaskLocalHandoffPath(value: unknown): string | null {
  if (typeof value === 'string') {
    return extractTaskLocalHandoffPath(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const offendingPath = findTaskLocalHandoffPath(entry);
      if (offendingPath) {
        return offendingPath;
      }
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const offendingPath = findTaskLocalHandoffPath(entry);
    if (offendingPath) {
      return offendingPath;
    }
  }
  return null;
}

function extractTaskLocalHandoffPath(text: string): string | null {
  for (const pattern of TASK_LOCAL_HANDOFF_PATH_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function serializeJsonb(value: unknown) {
  return JSON.stringify(value);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isEditableTaskState(state: string | null) {
  return state === 'pending' || state === 'claimed' || state === 'in_progress';
}
