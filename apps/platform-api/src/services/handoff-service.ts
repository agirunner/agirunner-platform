import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { LogService } from '../logging/log-service.js';
import { logPredecessorHandoffResolution } from '../logging/predecessor-handoff-log.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { resolveRelevantHandoffs } from './predecessor-handoff-resolver.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';
import type { EventService } from './event-service.js';
import {
  enqueueAndDispatchImmediatePlaybookActivation,
  type ImmediateWorkflowActivationDispatcher,
} from './workflow-immediate-activation.js';

const HANDOFF_SECRET_REDACTION = 'redacted://handoff-secret';

export interface SubmitTaskHandoffInput {
  request_id?: string;
  summary: string;
  completion: 'full' | 'partial' | 'blocked';
  changes?: unknown[];
  decisions?: unknown[];
  remaining_items?: unknown[];
  blockers?: unknown[];
  review_focus?: string[];
  known_risks?: string[];
  successor_context?: string;
  role_data?: Record<string, unknown>;
  artifact_ids?: string[];
}

interface TaskContextRow {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  work_item_id: string | null;
  role: string | null;
  stage_name: string | null;
  state: string | null;
  rework_count: number | null;
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
  changes: unknown[];
  decisions: unknown[];
  remaining_items: unknown[];
  blockers: unknown[];
  review_focus: string[];
  known_risks: string[];
  successor_context: string | null;
  role_data: Record<string, unknown>;
  artifact_ids: string[];
  created_at: Date;
}

export class HandoffService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly logService?: LogService,
    private readonly eventService?: EventService,
    private readonly activationDispatchService?: ImmediateWorkflowActivationDispatcher,
  ) {}

  async assertRequiredTaskHandoffBeforeCompletion(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const taskId = readOptionalString(task.id);
    const workflowId = readOptionalString(task.workflow_id);
    const role = readOptionalString(task.role);
    const taskReworkCount = readInteger(task.rework_count) ?? 0;
    if (!taskId || !workflowId || !role) {
      return;
    }

    const definition = await this.loadWorkflowPlaybookDefinition(tenantId, workflowId, db);
    if (!definition) {
      return;
    }
    const requiresHandoff = definition.handoff_rules.some(
      (rule) => rule.required !== false && rule.from_role === role,
    );
    if (!requiresHandoff) {
      return;
    }

    const handoffResult = await db.query<{ id: string }>(
      `SELECT id
         FROM task_handoffs
        WHERE tenant_id = $1
          AND task_id = $2
          AND task_rework_count = $3
        LIMIT 1`,
      [tenantId, taskId, taskReworkCount],
    );
    if (handoffResult.rowCount) {
      return;
    }

    throw new ValidationError('Task requires a structured handoff before completion');
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

    const payload = buildNormalizedHandoffPayload(task, input);
    const replayMatch = await this.loadExistingHandoff(
      tenantId,
      task.workflow_id,
      payload.request_id,
      db,
    );
    if (replayMatch) {
      assertMatchingHandoffReplay(replayMatch, payload);
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
        return toTaskHandoffResponse(existingTaskAttempt);
      }
      if (!isEditableTaskState(task.state)) {
        throw new ConflictError('task handoff request replay does not match the existing handoff');
      }
      const updated = await this.updateExistingHandoff(existingTaskAttempt.id, payload, db);
      await this.enqueueWorkflowActivation(task, payload, db);
      return updated;
    }

    const sequence = await this.loadNextSequence(tenantId, task.workflow_id, task.work_item_id, db);
    const result = await db.query<TaskHandoffRow>(
      `INSERT INTO task_handoffs (
         tenant_id, workflow_id, work_item_id, task_id, task_rework_count, request_id, role, team_name, stage_name, sequence,
         summary, completion, changes, decisions, remaining_items, blockers, review_focus,
         known_risks, successor_context, role_data, artifact_ids
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::text[],
         $18::text[], $19, $20::jsonb, $21::uuid[]
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
        serializeJsonb(payload.changes),
        serializeJsonb(payload.decisions),
        serializeJsonb(payload.remaining_items),
        serializeJsonb(payload.blockers),
        payload.review_focus,
        payload.known_risks,
        payload.successor_context,
        serializeJsonb(payload.role_data),
        payload.artifact_ids,
      ],
    );
    if (result.rowCount) {
      await this.enqueueWorkflowActivation(task, payload, db);
      return toTaskHandoffResponse(result.rows[0]);
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
    await this.enqueueWorkflowActivation(task, payload, db);
    return updated;
  }

  private async enqueueWorkflowActivation(
    task: TaskContextRow,
    payload: ReturnType<typeof buildNormalizedHandoffPayload>,
    db: DatabaseClient | DatabasePool,
  ) {
    if (!task.workflow_id || !this.eventService) {
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
      `SELECT id, tenant_id, workflow_id, work_item_id, role, stage_name, state, rework_count, metadata
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, taskId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }
    return result.rows[0];
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
              changes = $8::jsonb,
              decisions = $9::jsonb,
              remaining_items = $10::jsonb,
              blockers = $11::jsonb,
              review_focus = $12::text[],
              known_risks = $13::text[],
              successor_context = $14,
              role_data = $15::jsonb,
              artifact_ids = $16::uuid[]
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
        serializeJsonb(payload.changes),
        serializeJsonb(payload.decisions),
        serializeJsonb(payload.remaining_items),
        serializeJsonb(payload.blockers),
        payload.review_focus,
        payload.known_risks,
        payload.successor_context,
        serializeJsonb(payload.role_data),
        payload.artifact_ids,
      ],
    );
    if (!result.rowCount) {
      throw new ConflictError('Task handoff conflicted but could not be updated');
    }
    return toTaskHandoffResponse(result.rows[0]);
  }
}

function buildNormalizedHandoffPayload(task: TaskContextRow, input: SubmitTaskHandoffInput) {
  const summary = sanitizeHandoffValue(input.summary.trim());
  return {
    task_rework_count: readInteger(task.rework_count) ?? 0,
    request_id: input.request_id?.trim() || null,
    role: task.role?.trim() || 'specialist',
    team_name: readOptionalString(task.metadata?.team_name),
    stage_name: task.stage_name?.trim() || null,
    summary: typeof summary === 'string' ? summary : input.summary.trim(),
    completion: input.completion,
    changes: normalizeArray(sanitizeHandoffValue(input.changes)),
    decisions: normalizeArray(sanitizeHandoffValue(input.decisions)),
    remaining_items: normalizeArray(sanitizeHandoffValue(input.remaining_items)),
    blockers: normalizeArray(sanitizeHandoffValue(input.blockers)),
    review_focus: normalizeStringArray(sanitizeHandoffValue(input.review_focus)),
    known_risks: normalizeStringArray(sanitizeHandoffValue(input.known_risks)),
    successor_context: readOptionalString(sanitizeHandoffValue(input.successor_context)),
    role_data: sanitizeHandoffRecord(input.role_data),
    artifact_ids: normalizeStringArray(input.artifact_ids),
  };
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
  return !(
    existing.role !== expected.role ||
    (existing.team_name ?? null) !== expected.team_name ||
    (existing.stage_name ?? null) !== expected.stage_name ||
    existing.summary !== expected.summary ||
    existing.completion !== expected.completion ||
    !areJsonValuesEquivalent(existing.changes, expected.changes) ||
    !areJsonValuesEquivalent(existing.decisions, expected.decisions) ||
    !areJsonValuesEquivalent(existing.remaining_items, expected.remaining_items) ||
    !areJsonValuesEquivalent(existing.blockers, expected.blockers) ||
    !areJsonValuesEquivalent(existing.review_focus, expected.review_focus) ||
    !areJsonValuesEquivalent(existing.known_risks, expected.known_risks) ||
    (existing.successor_context ?? null) !== expected.successor_context ||
    !areJsonValuesEquivalent(existing.role_data, expected.role_data) ||
    !areJsonValuesEquivalent(existing.artifact_ids, expected.artifact_ids)
  );
}

function toTaskHandoffResponse(row: TaskHandoffRow) {
  const sanitized = sanitizeHandoffValue(row) as TaskHandoffRow;
  return {
    ...sanitized,
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

function normalizeRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
