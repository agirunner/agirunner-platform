import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';

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
  metadata: Record<string, unknown> | null;
}

interface TaskHandoffRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string;
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
  constructor(private readonly pool: DatabasePool) {}

  async assertRequiredTaskHandoffBeforeCompletion(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    const taskId = readOptionalString(task.id);
    const workflowId = readOptionalString(task.workflow_id);
    const role = readOptionalString(task.role);
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
        LIMIT 1`,
      [tenantId, taskId],
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
    const sequence = await this.loadNextSequence(
      tenantId,
      task.workflow_id,
      task.work_item_id,
      db,
    );
    const result = await db.query<TaskHandoffRow>(
      `INSERT INTO task_handoffs (
         tenant_id, workflow_id, work_item_id, task_id, request_id, role, team_name, stage_name, sequence,
         summary, completion, changes, decisions, remaining_items, blockers, review_focus,
         known_risks, successor_context, role_data, artifact_ids
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::text[],
         $17::text[], $18, $19::jsonb, $20::uuid[]
       )
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        tenantId,
        task.workflow_id,
        task.work_item_id,
        task.id,
        payload.request_id,
        payload.role,
        payload.team_name,
        payload.stage_name,
        sequence,
        payload.summary,
        payload.completion,
        payload.changes,
        payload.decisions,
        payload.remaining_items,
        payload.blockers,
        payload.review_focus,
        payload.known_risks,
        payload.successor_context,
        payload.role_data,
        payload.artifact_ids,
      ],
    );
    if (result.rowCount) {
      return toTaskHandoffResponse(result.rows[0]);
    }

    const existing = await this.loadExistingHandoff(
      tenantId,
      task.workflow_id,
      taskId,
      input.request_id,
      db,
    );
    if (!existing) {
      throw new ConflictError('Task handoff conflicted but no matching row could be loaded');
    }
    assertMatchingHandoffReplay(existing, payload);
    return toTaskHandoffResponse(existing);
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
    if (!task.workflow_id || !task.work_item_id) {
      return null;
    }
    const result = await db.query<TaskHandoffRow>(
      `SELECT *
         FROM task_handoffs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND task_id <> $4
        ORDER BY sequence DESC, created_at DESC
        LIMIT 1`,
      [tenantId, task.workflow_id, task.work_item_id, taskId],
    );
    return result.rows[0] ? toTaskHandoffResponse(result.rows[0]) : null;
  }

  private async loadTask(
    tenantId: string,
    taskId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<TaskContextRow>(
      `SELECT id, tenant_id, workflow_id, work_item_id, role, stage_name, metadata
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
    taskId: string,
    requestId: string | undefined,
    db: DatabaseClient | DatabasePool,
  ) {
    if (requestId?.trim()) {
      const byRequestId = await db.query<TaskHandoffRow>(
        `SELECT *
           FROM task_handoffs
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND request_id = $3
          LIMIT 1`,
        [tenantId, workflowId, requestId.trim()],
      );
      if (byRequestId.rowCount) {
        return byRequestId.rows[0];
      }
    }

    const byTaskId = await db.query<TaskHandoffRow>(
      `SELECT *
         FROM task_handoffs
        WHERE tenant_id = $1
          AND task_id = $2
        LIMIT 1`,
      [tenantId, taskId],
    );
    return byTaskId.rows[0] ?? null;
  }
}

function buildNormalizedHandoffPayload(task: TaskContextRow, input: SubmitTaskHandoffInput) {
  return {
    request_id: input.request_id?.trim() || null,
    role: task.role?.trim() || 'specialist',
    team_name: readOptionalString(task.metadata?.team_name),
    stage_name: task.stage_name?.trim() || null,
    summary: input.summary.trim(),
    completion: input.completion,
    changes: normalizeArray(input.changes),
    decisions: normalizeArray(input.decisions),
    remaining_items: normalizeArray(input.remaining_items),
    blockers: normalizeArray(input.blockers),
    review_focus: normalizeStringArray(input.review_focus),
    known_risks: normalizeStringArray(input.known_risks),
    successor_context: readOptionalString(input.successor_context),
    role_data: normalizeRecord(input.role_data),
    artifact_ids: normalizeStringArray(input.artifact_ids),
  };
}

function assertMatchingHandoffReplay(
  existing: TaskHandoffRow,
  expected: ReturnType<typeof buildNormalizedHandoffPayload>,
) {
  if (
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
  ) {
    throw new ConflictError('task handoff request replay does not match the existing handoff');
  }
}

function toTaskHandoffResponse(row: TaskHandoffRow) {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
  };
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

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
