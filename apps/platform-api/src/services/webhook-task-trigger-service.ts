import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../errors/domain-errors.js';
import type { TaskService } from './task-service.js';
import { EventService } from './event-service.js';
import { decryptWebhookSecret, encryptWebhookSecret } from './webhook-secret-crypto.js';

type SignatureMode = 'hmac_sha256' | 'shared_secret';
type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

interface TriggerRow {
  id: string;
  tenant_id: string;
  name: string;
  source: string;
  project_id: string | null;
  workflow_id: string | null;
  event_header: string | null;
  event_types: string[] | null;
  signature_header: string;
  signature_mode: SignatureMode;
  secret: string;
  field_mappings: Record<string, unknown>;
  defaults: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface InvocationRow {
  id: string;
  task_id: string | null;
  status: string;
}

interface TriggerInvocationHeaders {
  [key: string]: string | string[] | undefined;
}

export interface CreateWebhookTaskTriggerInput {
  name: string;
  source: string;
  project_id?: string;
  workflow_id?: string;
  event_header?: string;
  event_types?: string[];
  signature_header: string;
  signature_mode: SignatureMode;
  secret: string;
  field_mappings?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateWebhookTaskTriggerInput {
  name?: string;
  source?: string;
  project_id?: string | null;
  workflow_id?: string | null;
  event_header?: string | null;
  event_types?: string[];
  signature_header?: string;
  signature_mode?: SignatureMode;
  secret?: string;
  field_mappings?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  is_active?: boolean;
}

interface NormalizedInvocation {
  eventType: string | null;
  dedupeKey: string | null;
  createTaskInput: {
    title: string;
    priority?: TaskPriority;
    description?: string;
    role?: string;
    workflow_id?: string;
    project_id?: string;
    metadata?: Record<string, unknown>;
    input?: Record<string, unknown>;
    capabilities_required?: string[];
  };
}

const allowedPriorities = new Set<TaskPriority>(['critical', 'high', 'normal', 'low']);

export class WebhookTaskTriggerService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly taskService: TaskService,
    private readonly encryptionKey: string,
  ) {}

  async createTrigger(identity: ApiKeyIdentity, input: CreateWebhookTaskTriggerInput) {
    const normalized = await this.normalizeTriggerInput(identity.tenantId, input);
    const result = await this.pool.query<TriggerRow>(
      `INSERT INTO webhook_task_triggers (
         tenant_id, name, source, project_id, workflow_id, event_header, event_types,
         signature_header, signature_mode, secret, field_mappings, defaults, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
       RETURNING *`,
      [
        identity.tenantId,
        normalized.name,
        normalized.source,
        normalized.project_id,
        normalized.workflow_id,
        normalized.event_header,
        normalized.event_types,
        normalized.signature_header,
        normalized.signature_mode,
        normalized.secret,
        normalized.field_mappings,
        normalized.defaults,
        normalized.is_active,
      ],
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'trigger.created',
      entityType: 'workflow',
      entityId: normalized.workflow_id ?? normalized.project_id ?? result.rows[0].id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { trigger_id: result.rows[0].id, source: normalized.source },
    });

    return toPublicTrigger(result.rows[0]);
  }

  async updateTrigger(tenantId: string, triggerId: string, input: UpdateWebhookTaskTriggerInput) {
    const current = await this.loadTriggerRow(tenantId, triggerId);
    const merged = {
      name: input.name ?? current.name,
      source: input.source ?? current.source,
      project_id: input.project_id === undefined ? current.project_id : input.project_id,
      workflow_id: input.workflow_id === undefined ? current.workflow_id : input.workflow_id,
      event_header: input.event_header === undefined ? current.event_header : input.event_header,
      event_types: input.event_types ?? current.event_types ?? [],
      signature_header: input.signature_header ?? current.signature_header,
      signature_mode: input.signature_mode ?? current.signature_mode,
      secret: input.secret
        ? encryptWebhookSecret(input.secret, this.encryptionKey)
        : current.secret,
      field_mappings: input.field_mappings ?? current.field_mappings ?? {},
      defaults: input.defaults ?? current.defaults ?? {},
      is_active: input.is_active ?? current.is_active,
    };
    await this.assertScopeTargets(tenantId, merged.project_id ?? undefined, merged.workflow_id ?? undefined);
    validateTriggerDefinition(merged);

    const result = await this.pool.query<TriggerRow>(
      `UPDATE webhook_task_triggers
          SET name = $3,
              source = $4,
              project_id = $5,
              workflow_id = $6,
              event_header = $7,
              event_types = $8,
              signature_header = $9,
              signature_mode = $10,
              secret = $11,
              field_mappings = $12::jsonb,
              defaults = $13::jsonb,
              is_active = $14,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      RETURNING *`,
      [
        tenantId,
        triggerId,
        merged.name,
        merged.source,
        merged.project_id,
        merged.workflow_id,
        merged.event_header,
        merged.event_types,
        merged.signature_header,
        merged.signature_mode,
        merged.secret,
        merged.field_mappings,
        merged.defaults,
        merged.is_active,
      ],
    );

    return toPublicTrigger(result.rows[0]);
  }

  async listTriggers(tenantId: string) {
    const result = await this.pool.query<TriggerRow>(
      `SELECT *
         FROM webhook_task_triggers
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return { data: result.rows.map(toPublicTrigger) };
  }

  async deleteTrigger(tenantId: string, triggerId: string) {
    await this.pool.query(
      'DELETE FROM webhook_task_trigger_invocations WHERE tenant_id = $1 AND trigger_id = $2',
      [tenantId, triggerId],
    );
    const result = await this.pool.query(
      'DELETE FROM webhook_task_triggers WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [tenantId, triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Webhook task trigger not found');
    }
    return { id: triggerId, deleted: true };
  }

  async invokeTrigger(
    triggerId: string,
    headers: TriggerInvocationHeaders,
    rawBody: Buffer,
    payload: Record<string, unknown>,
  ) {
    const trigger = await this.loadTriggerById(triggerId);
    if (!trigger.is_active) {
      throw new UnauthorizedError('Webhook trigger is inactive');
    }

    const eventType = readHeader(headers, trigger.event_header);
    if (trigger.event_types && trigger.event_types.length > 0) {
      if (!eventType || !trigger.event_types.includes(eventType)) {
        return {
          accepted: true,
          created: false,
          reason: 'event_filtered',
          event_type: eventType,
        };
      }
    }

    verifyTriggerSignature(trigger, headers, rawBody, this.encryptionKey);
    const normalized = buildTriggeredTask(trigger, payload, eventType);
    const dedupeKey = normalized.dedupeKey;

    if (dedupeKey) {
      const existing = await this.pool.query<InvocationRow>(
        `SELECT id, task_id, status
           FROM webhook_task_trigger_invocations
          WHERE tenant_id = $1
            AND trigger_id = $2
            AND dedupe_key = $3
          LIMIT 1`,
        [trigger.tenant_id, trigger.id, dedupeKey],
      );
      if (existing.rowCount) {
        return {
          accepted: true,
          created: false,
          duplicate: true,
          task_id: existing.rows[0].task_id,
          event_type: eventType,
        };
      }
    }

    const identity = triggerIdentity(trigger);
    const createdTask = await this.taskService.createTask(identity, normalized.createTaskInput);

    await this.pool.query(
      `INSERT INTO webhook_task_trigger_invocations (tenant_id, trigger_id, event_type, dedupe_key, task_id, status)
       VALUES ($1,$2,$3,$4,$5,'created')`,
      [trigger.tenant_id, trigger.id, eventType, dedupeKey, createdTask.id],
    );

    await this.eventService.emit({
      tenantId: trigger.tenant_id,
      type: 'trigger.fired',
      entityType: 'task',
      entityId: createdTask.id as string,
      actorType: 'system',
      actorId: `trigger:${trigger.id}`,
      data: {
        trigger_id: trigger.id,
        source: trigger.source,
        event_type: eventType,
      },
    });

    return {
      accepted: true,
      created: true,
      task_id: createdTask.id,
      event_type: eventType,
    };
  }

  private async normalizeTriggerInput(tenantId: string, input: CreateWebhookTaskTriggerInput) {
    await this.assertScopeTargets(tenantId, input.project_id, input.workflow_id);
    const normalized = {
      name: input.name.trim(),
      source: input.source.trim(),
      project_id: input.project_id ?? null,
      workflow_id: input.workflow_id ?? null,
      event_header: input.event_header?.trim() || null,
      event_types: input.event_types ?? [],
      signature_header: input.signature_header.trim(),
      signature_mode: input.signature_mode,
      secret: encryptWebhookSecret(input.secret, this.encryptionKey),
      field_mappings: input.field_mappings ?? {},
      defaults: input.defaults ?? {},
      is_active: input.is_active ?? true,
    };
    validateTriggerDefinition(normalized);
    return normalized;
  }

  private async assertScopeTargets(
    tenantId: string,
    projectId?: string | null,
    workflowId?: string | null,
  ) {
    if (!projectId && !workflowId) {
      throw new ValidationError('Webhook task triggers must target a project or workflow');
    }

    if (projectId) {
      const project = await this.pool.query('SELECT id FROM projects WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        projectId,
      ]);
      if (!project.rowCount) {
        throw new NotFoundError('Project not found');
      }
    }

    if (workflowId) {
      const workflow = await this.pool.query<{ project_id: string | null }>(
        'SELECT project_id FROM workflows WHERE tenant_id = $1 AND id = $2',
        [tenantId, workflowId],
      );
      if (!workflow.rowCount) {
        throw new NotFoundError('Workflow not found');
      }
      if (projectId && workflow.rows[0].project_id !== projectId) {
        throw new ValidationError('Workflow and project targets must belong to the same project scope');
      }
    }
  }

  private async loadTriggerRow(tenantId: string, triggerId: string) {
    const result = await this.pool.query<TriggerRow>(
      'SELECT * FROM webhook_task_triggers WHERE tenant_id = $1 AND id = $2',
      [tenantId, triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Webhook task trigger not found');
    }
    return result.rows[0];
  }

  private async loadTriggerById(triggerId: string) {
    const result = await this.pool.query<TriggerRow>(
      'SELECT * FROM webhook_task_triggers WHERE id = $1',
      [triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Webhook task trigger not found');
    }
    return result.rows[0];
  }
}

function validateTriggerDefinition(input: {
  name: string;
  source: string;
  signature_header: string;
  signature_mode: SignatureMode;
  field_mappings: Record<string, unknown>;
  defaults: Record<string, unknown>;
}): void {
  if (!input.name) {
    throw new ValidationError('name is required');
  }
  if (!input.source) {
    throw new ValidationError('source is required');
  }
  if (!input.signature_header) {
    throw new ValidationError('signature_header is required');
  }
  validateDefaults(input.defaults);
  validateMappings(input.field_mappings);
}

function validateDefaults(defaults: Record<string, unknown>): void {
  if (defaults.priority !== undefined && !allowedPriorities.has(defaults.priority as TaskPriority)) {
    throw new ValidationError('defaults.priority must be a supported priority');
  }
}

function validateMappings(mappings: Record<string, unknown>): void {
  const titleMapping = mappings.title;
  if (titleMapping !== undefined && typeof titleMapping !== 'string') {
    throw new ValidationError('field_mappings.title must be a string payload path');
  }
}

function toPublicTrigger(row: TriggerRow) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    project_id: row.project_id,
    workflow_id: row.workflow_id,
    event_header: row.event_header,
    event_types: row.event_types ?? [],
    signature_header: row.signature_header,
    signature_mode: row.signature_mode,
    field_mappings: row.field_mappings ?? {},
    defaults: row.defaults ?? {},
    is_active: row.is_active,
    secret_configured: true,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function verifyTriggerSignature(
  trigger: TriggerRow,
  headers: TriggerInvocationHeaders,
  rawBody: Buffer,
  encryptionKey: string,
) {
  const signature = readHeader(headers, trigger.signature_header);
  if (!signature) {
    throw new UnauthorizedError('Webhook signature is invalid');
  }
  const secret = decryptWebhookSecret(trigger.secret, encryptionKey);
  if (trigger.signature_mode === 'shared_secret') {
    if (!constantTimeEquals(signature, secret)) {
      throw new UnauthorizedError('Webhook signature is invalid');
    }
    return;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
  if (!constantTimeEquals(provided, expected)) {
    throw new UnauthorizedError('Webhook signature is invalid');
  }
}

function buildTriggeredTask(
  trigger: TriggerRow,
  payload: Record<string, unknown>,
  eventType: string | null,
): NormalizedInvocation {
  const defaults = asRecord(trigger.defaults);
  const mappings = asRecord(trigger.field_mappings);
  const title = asString(resolveMapping(mappings.title, payload, eventType)) ?? asString(defaults.title);
  if (!title) {
    throw new ValidationError('Trigger field mappings did not produce a task title');
  }

  const priority = normalizePriority(resolveMapping(mappings.priority, payload, eventType) ?? defaults.priority);
  const description = asString(resolveMapping(mappings.description, payload, eventType) ?? defaults.description);
  const role = asString(resolveMapping(mappings.role, payload, eventType) ?? defaults.role);
  const metadata = mergeRecords(
    asRecord(defaults.metadata),
    mapRecord(asRecord(mappings.metadata), payload, eventType),
    {
      trigger: {
        trigger_id: trigger.id,
        source: trigger.source,
        event_type: eventType,
      },
    },
  );
  const input = mergeRecords(
    asRecord(defaults.input),
    mapRecord(asRecord(mappings.input), payload, eventType),
  );
  const capabilities = normalizeStringArray(
    resolveMapping(mappings.capabilities_required, payload, eventType) ?? defaults.capabilities_required,
  );
  const dedupeKey = asDedupeKey(resolveMapping(mappings.dedupe_key, payload, eventType));

  return {
    eventType,
    dedupeKey: dedupeKey ?? null,
    createTaskInput: {
      title,
      ...(priority ? { priority } : {}),
      ...(description ? { description } : {}),
      ...(role ? { role } : {}),
      ...(trigger.workflow_id ? { workflow_id: trigger.workflow_id } : {}),
      ...(trigger.project_id ? { project_id: trigger.project_id } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...(Object.keys(input).length > 0 ? { input } : {}),
      ...(capabilities.length > 0 ? { capabilities_required: capabilities } : {}),
    },
  };
}

function resolveMapping(mapping: unknown, payload: Record<string, unknown>, eventType: string | null): unknown {
  if (typeof mapping !== 'string') {
    return mapping;
  }
  if (mapping === '$payload') {
    return payload;
  }
  if (mapping === '$event_type') {
    return eventType;
  }
  return readPath(payload, mapping);
}

function mapRecord(
  mapping: Record<string, unknown>,
  payload: Record<string, unknown>,
  eventType: string | null,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === 'string') {
      const resolved = resolveMapping(value, payload, eventType);
      if (resolved !== undefined) {
        result[key] = resolved;
      }
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = mapRecord(value as Record<string, unknown>, payload, eventType);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      continue;
    }
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, payload);
}

function normalizePriority(value: unknown): TaskPriority | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return allowedPriorities.has(value as TaskPriority) ? (value as TaskPriority) : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }
  return [];
}

function mergeRecords(...records: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    Object.assign(merged, record);
  }
  return merged;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asDedupeKey(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function readHeader(headers: TriggerInvocationHeaders, headerName: string | null): string | null {
  if (!headerName) {
    return null;
  }
  const rawValue = headers[headerName.toLowerCase()];
  if (Array.isArray(rawValue)) {
    return rawValue[0] ?? null;
  }
  return typeof rawValue === 'string' ? rawValue : null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function triggerIdentity(trigger: TriggerRow): ApiKeyIdentity {
  return {
    id: `trigger:${trigger.id}`,
    tenantId: trigger.tenant_id,
    scope: 'admin',
    ownerType: 'system',
    ownerId: null,
    keyPrefix: `trigger:${trigger.id}`,
  };
}
