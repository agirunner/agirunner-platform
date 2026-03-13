import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';
import {
  enqueueWorkflowActivationRecord,
  type WorkflowActivationEventRow,
} from './workflow-activation-record.js';

export interface EnqueueWorkflowActivationInput {
  request_id?: string;
  reason: string;
  event_type: string;
  payload?: Record<string, unknown>;
}

interface EnqueueActivationParams {
  tenantId: string;
  workflowId: string;
  requestId?: string;
  reason: string;
  eventType: string;
  payload?: Record<string, unknown>;
  actorType?: string;
  actorId?: string;
}

interface ActivationRow {
  id: string;
  activation_id: string | null;
  workflow_id: string;
  request_id: string | null;
  reason: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  state: string;
  dispatch_attempt: number;
  dispatch_token: string | null;
  queued_at: Date;
  started_at: Date | null;
  consumed_at: Date | null;
  completed_at: Date | null;
  summary: string | null;
  error: Record<string, unknown> | null;
}

interface ActivationRecoveryPayload {
  status: string;
  reason: string;
  detected_at: string | null;
  stale_started_at: string | null;
  stale_after_ms: number | null;
  task_id?: string | null;
  recovered_at?: string | null;
  redispatched_at?: string | null;
  redispatched_task_id?: string | null;
}

interface ActivationListOptions {
  state?: string;
  recovery_status?: string;
  limit?: number;
}

export class WorkflowActivationService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async enqueue(identity: ApiKeyIdentity, workflowId: string, input: EnqueueWorkflowActivationInput): Promise<Record<string, unknown>>;
  async enqueue(params: EnqueueActivationParams, client?: DatabaseClient): Promise<Record<string, unknown>>;
  async enqueue(
    identityOrParams: ApiKeyIdentity | EnqueueActivationParams,
    workflowIdOrClient?: string | DatabaseClient,
    input?: EnqueueWorkflowActivationInput,
  ) {
    if ('scope' in identityOrParams) {
      return this.enqueueForWorkflow(
        {
          tenantId: identityOrParams.tenantId,
          workflowId: workflowIdOrClient as string,
          requestId: input?.request_id,
          reason: input?.reason ?? '',
          eventType: input?.event_type ?? '',
          payload: input?.payload,
          actorType: identityOrParams.scope,
          actorId: identityOrParams.keyPrefix,
        },
        undefined,
      );
    }
    return this.enqueueForWorkflow(identityOrParams, workflowIdOrClient as DatabaseClient | undefined);
  }

  async enqueueForWorkflow(params: EnqueueActivationParams, client?: DatabaseClient) {
    const db = client ?? this.pool;
    await this.assertWorkflow(params.tenantId, params.workflowId, db);
    const activation = await enqueueWorkflowActivationRecord(db, this.eventService, params);
    assertIdempotentActivationReplay(activation, params);
    return toActivationResponse(activation as ActivationRow);
  }

  async list(tenantId: string, workflowId: string, options?: ActivationListOptions) {
    return { data: await this.listWorkflowActivations(tenantId, workflowId, options) };
  }

  async listWorkflowActivations(tenantId: string, workflowId: string, options: ActivationListOptions = {}) {
    await this.assertWorkflow(tenantId, workflowId);
    const conditions = ['tenant_id = $1', 'workflow_id = $2'];
    const values: unknown[] = [tenantId, workflowId];
    const limit = options.limit && Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : null;

    if (options.state) {
      values.push(options.state);
      conditions.push(`
        CASE
          WHEN consumed_at IS NOT NULL THEN 'completed'
          WHEN (activation_id IS NOT NULL AND consumed_at IS NULL) OR state = 'processing' THEN 'processing'
          ELSE 'queued'
        END = $${values.length}
      `);
    }

    if (options.recovery_status) {
      values.push(options.recovery_status);
      conditions.push(`COALESCE(error->'recovery'->>'status', '') = $${values.length}`);
    }

    const result = await this.pool.query<ActivationRow>(
      `SELECT id, workflow_id, activation_id, request_id, reason, event_type, payload, state,
              dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error
         FROM workflow_activations
        WHERE ${conditions.join(' AND ')}
        ORDER BY queued_at ASC, id ASC`,
      values,
    );
    const grouped = groupActivationRows(result.rows).map((rows) => {
      const anchor = findActivationAnchor(rows);
      return toActivationResponse(anchor, rows);
    });
    return limit ? grouped.slice(0, limit) : grouped;
  }

  async get(tenantId: string, workflowId: string, activationId: string) {
    return { data: await this.getWorkflowActivation(tenantId, workflowId, activationId) };
  }

  async getWorkflowActivation(tenantId: string, workflowId: string, activationId: string) {
    await this.assertWorkflow(tenantId, workflowId);
    const result = await this.pool.query<ActivationRow>(
      `SELECT id, workflow_id, activation_id, request_id, reason, event_type, payload, state,
              dispatch_attempt, dispatch_token, queued_at, started_at, consumed_at, completed_at, summary, error
         FROM workflow_activations
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND (id = $3 OR activation_id = $3)
        ORDER BY queued_at ASC, id ASC`,
      [tenantId, workflowId, activationId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow activation not found');
    }
    const anchor = findActivationAnchor(result.rows);
    return toActivationResponse(anchor, result.rows);
  }

  private async assertWorkflow(tenantId: string, workflowId: string, db: DatabaseClient | DatabasePool = this.pool) {
    const result = await db.query('SELECT id FROM workflows WHERE tenant_id = $1 AND id = $2', [tenantId, workflowId]);
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
  }
}

function toActivationResponse(row: ActivationRow, rows: ActivationRow[] = [row]) {
  const sanitizedError = sanitizeActivationError(row.error);
  const recovery = readActivationRecovery(rows);
  const sortedRows = rows
    .slice()
    .sort((left, right) => left.queued_at.getTime() - right.queued_at.getTime());
  const activationReason = deriveActivationReason(sortedRows);
  const dispatchableRows = listDispatchableActivationRows(sortedRows);
  const primaryRow = findPrimaryActivationRow(row, sortedRows);
  const eventTypes =
    dispatchableRows.length > 0
      ? Array.from(new Set(dispatchableRows.map((event) => event.event_type)))
      : ['heartbeat'];
  const latestEventAt =
    (dispatchableRows[dispatchableRows.length - 1] ?? sortedRows[sortedRows.length - 1] ?? row).queued_at.toISOString();

  return {
    id: row.id,
    activation_id: row.activation_id ?? row.id,
    workflow_id: row.workflow_id,
    request_id: row.request_id,
    reason: primaryRow.reason,
    event_type: primaryRow.event_type,
    activation_reason: activationReason,
    payload: sanitizeSecretLikeRecord(primaryRow.payload, {
      redactionValue: 'redacted://activation-secret',
      allowSecretReferences: false,
    }),
    state: deriveActivationState(row),
    dispatch_attempt: row.dispatch_attempt,
    dispatch_token: row.dispatch_token,
    queued_at: row.queued_at.toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    consumed_at: row.consumed_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    summary: sanitizeActivationSummary(row.summary),
    error: sanitizedError,
    recovery: recovery,
    recovery_status: recovery?.status ?? null,
    recovery_reason: recovery?.reason ?? null,
    recovery_detected_at: recovery?.detected_at ?? null,
    stale_started_at: recovery?.stale_started_at ?? null,
    redispatched_task_id: recovery?.redispatched_task_id ?? null,
    event_types: eventTypes,
    latest_event_at: latestEventAt,
    event_count: dispatchableRows.length,
    events: dispatchableRows.map((event) => serializeEvent(event)),
  };
}

function deriveActivationState(row: ActivationRow) {
  if (row.consumed_at) {
    return 'completed';
  }
  if ((row.activation_id && !row.consumed_at) || row.state === 'processing') {
    return 'processing';
  }
  return 'queued';
}

function serializeEvent(row: WorkflowActivationEventRow) {
  const sanitizedError = sanitizeActivationError(row.error);
  return {
    id: row.id,
    activation_id: row.activation_id ?? row.id,
    request_id: row.request_id,
    reason: row.reason,
    event_type: row.event_type,
    payload: sanitizeSecretLikeRecord(row.payload, {
      redactionValue: 'redacted://activation-secret',
      allowSecretReferences: false,
    }),
    state: deriveActivationState(row),
    dispatch_attempt: row.dispatch_attempt,
    dispatch_token: row.dispatch_token,
    queued_at: row.queued_at.toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    consumed_at: row.consumed_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    summary: sanitizeActivationSummary(row.summary),
    error: sanitizedError,
    recovery: extractRecoveryPayload(sanitizedError),
  };
}

function readActivationRecovery(rows: ActivationRow[]): ActivationRecoveryPayload | null {
  for (const row of rows) {
    const payload = extractRecoveryPayload(sanitizeActivationError(row.error));
    if (payload) {
      return payload;
    }
  }
  return null;
}

function sanitizeActivationSummary(value: string | null): string | null {
  const sanitized = sanitizeSecretLikeValue(value, {
    redactionValue: 'redacted://activation-secret',
    allowSecretReferences: false,
  });
  return typeof sanitized === 'string' ? sanitized : null;
}

function sanitizeActivationError(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://activation-secret',
    allowSecretReferences: false,
  });
}

function extractRecoveryPayload(error: Record<string, unknown> | null): ActivationRecoveryPayload | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const recovery = error.recovery;
  if (!recovery || typeof recovery !== 'object') {
    return null;
  }
  const value = recovery as Record<string, unknown>;
  const status = typeof value.status === 'string' ? value.status : null;
  const reason = typeof value.reason === 'string' ? value.reason : null;
  if (!status || !reason) {
    return null;
  }
  return {
    status,
    reason,
    detected_at: typeof value.detected_at === 'string' ? value.detected_at : null,
    stale_started_at:
      typeof value.stale_started_at === 'string' ? value.stale_started_at : null,
    stale_after_ms:
      typeof value.stale_after_ms === 'number' ? value.stale_after_ms : null,
    task_id: typeof value.task_id === 'string' ? value.task_id : null,
    recovered_at: typeof value.recovered_at === 'string' ? value.recovered_at : null,
    redispatched_at:
      typeof value.redispatched_at === 'string' ? value.redispatched_at : null,
    redispatched_task_id:
      typeof value.redispatched_task_id === 'string'
        ? value.redispatched_task_id
        : null,
  };
}

function groupActivationRows(rows: ActivationRow[]) {
  const grouped = new Map<string, ActivationRow[]>();
  for (const row of rows) {
    const key = row.activation_id ?? row.id;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
      continue;
    }
    grouped.set(key, [row]);
  }
  return Array.from(grouped.values());
}

function findActivationAnchor(rows: ActivationRow[]) {
  const anchorId = rows[0]?.activation_id ?? rows[0]?.id;
  return rows.find((row) => row.id === anchorId) ?? rows[0];
}

function deriveActivationReason(rows: ActivationRow[]): 'queued_events' | 'heartbeat' {
  return rows.some((row) => row.event_type !== 'heartbeat') ? 'queued_events' : 'heartbeat';
}

function listDispatchableActivationRows(rows: ActivationRow[]): ActivationRow[] {
  return rows.filter((row) => row.event_type !== 'heartbeat');
}

function findPrimaryActivationRow(anchor: ActivationRow, rows: ActivationRow[]): ActivationRow {
  return rows.find((row) => row.event_type !== 'heartbeat') ?? anchor;
}

function assertIdempotentActivationReplay(
  activation: WorkflowActivationEventRow,
  params: EnqueueActivationParams,
): void {
  const expectedReason = params.reason.trim();
  const expectedEventType = params.eventType.trim();
  const expectedPayload = sanitizeSecretLikeRecord(params.payload ?? {}, {
    redactionValue: 'redacted://activation-secret',
    allowSecretReferences: false,
  });

  if (
    activation.reason !== expectedReason ||
    activation.event_type !== expectedEventType ||
    !areJsonValuesEquivalent(activation.payload ?? {}, expectedPayload)
  ) {
    throw new ConflictError('workflow activation request_id replay does not match the existing activation');
  }
}
