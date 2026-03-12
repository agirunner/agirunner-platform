import { createHmac, timingSafeEqual } from 'node:crypto';

import { UnauthorizedError, ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import type { CreateWorkItemInput } from './work-item-service.js';
import { decryptWebhookSecret } from './webhook-secret-crypto.js';

export type SignatureMode = 'hmac_sha256' | 'shared_secret';
export type WorkItemPriority = 'critical' | 'high' | 'normal' | 'low';

export interface WorkItemTriggerRow {
  id: string;
  tenant_id: string;
  name: string;
  source: string;
  project_id: string | null;
  workflow_id: string;
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

export interface WorkItemTriggerInvocationHeaders {
  [key: string]: string | string[] | undefined;
}

export interface BuiltTriggeredWorkItem {
  dedupeKey: string | null;
  eventType: string | null;
  requestId?: string;
  input: CreateWorkItemInput;
}

const allowedPriorities = new Set<WorkItemPriority>(['critical', 'high', 'normal', 'low']);

export function validateTriggerDefinition(input: {
  name: string;
  source: string;
  workflow_id?: string | null;
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
  if (!input.workflow_id) {
    throw new ValidationError('workflow_id is required');
  }
  if (!input.signature_header) {
    throw new ValidationError('signature_header is required');
  }
  validateDefaults(input.defaults);
  validateMappings(input.field_mappings);
}

export function toPublicTrigger(row: WorkItemTriggerRow) {
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
    field_mappings: sanitizeTriggerConfig(row.field_mappings),
    defaults: sanitizeTriggerConfig(row.defaults),
    is_active: row.is_active,
    secret_configured: true,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function sanitizeTriggerConfig(value: unknown) {
  return sanitizeSecretLikeRecord(value, { redactionValue: 'redacted://trigger-secret' });
}

export function verifyTriggerSignature(
  trigger: WorkItemTriggerRow,
  headers: WorkItemTriggerInvocationHeaders,
  rawBody: Buffer,
  encryptionKey: string,
): void {
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

export function buildTriggeredWorkItem(
  trigger: WorkItemTriggerRow,
  payload: Record<string, unknown>,
  eventType: string | null,
): BuiltTriggeredWorkItem {
  const defaults = asRecord(trigger.defaults);
  const mappings = asRecord(trigger.field_mappings);
  const title = asString(resolveMapping(mappings.title, payload, eventType)) ?? asString(defaults.title);
  if (!title) {
    throw new ValidationError('Trigger field mappings did not produce a work item title');
  }

  const dedupeKey = asDedupeKey(resolveMapping(mappings.dedupe_key, payload, eventType));
  return {
    dedupeKey: dedupeKey ?? null,
    eventType,
    ...(dedupeKey ? { requestId: `trigger:${trigger.id}:${dedupeKey}` } : {}),
    input: {
      title,
      ...(asString(resolveMapping(mappings.goal, payload, eventType) ?? defaults.goal)
        ? { goal: asString(resolveMapping(mappings.goal, payload, eventType) ?? defaults.goal) }
        : {}),
      ...(asString(resolveMapping(mappings.acceptance_criteria, payload, eventType) ?? defaults.acceptance_criteria)
        ? {
            acceptance_criteria: asString(
              resolveMapping(mappings.acceptance_criteria, payload, eventType) ?? defaults.acceptance_criteria,
            ),
          }
        : {}),
      ...(asString(resolveMapping(mappings.stage_name, payload, eventType) ?? defaults.stage_name)
        ? { stage_name: asString(resolveMapping(mappings.stage_name, payload, eventType) ?? defaults.stage_name) }
        : {}),
      ...(asString(resolveMapping(mappings.column_id, payload, eventType) ?? defaults.column_id)
        ? { column_id: asString(resolveMapping(mappings.column_id, payload, eventType) ?? defaults.column_id) }
        : {}),
      ...(asString(resolveMapping(mappings.owner_role, payload, eventType) ?? defaults.owner_role)
        ? { owner_role: asString(resolveMapping(mappings.owner_role, payload, eventType) ?? defaults.owner_role) }
        : {}),
      ...(normalizePriority(resolveMapping(mappings.priority, payload, eventType) ?? defaults.priority)
        ? { priority: normalizePriority(resolveMapping(mappings.priority, payload, eventType) ?? defaults.priority) }
        : {}),
      ...(asString(resolveMapping(mappings.notes, payload, eventType) ?? defaults.notes)
        ? { notes: asString(resolveMapping(mappings.notes, payload, eventType) ?? defaults.notes) }
        : {}),
      metadata: mergeRecords(
        asRecord(defaults.metadata),
        mapRecord(asRecord(mappings.metadata), payload, eventType),
        {
          trigger: {
            trigger_id: trigger.id,
            source: trigger.source,
            event_type: eventType,
          },
        },
      ),
    },
  };
}

function validateDefaults(defaults: Record<string, unknown>): void {
  if (defaults.priority !== undefined && !allowedPriorities.has(defaults.priority as WorkItemPriority)) {
    throw new ValidationError('defaults.priority must be a supported priority');
  }
}

function validateMappings(mappings: Record<string, unknown>): void {
  const titleMapping = mappings.title;
  if (titleMapping !== undefined && typeof titleMapping !== 'string') {
    throw new ValidationError('field_mappings.title must be a string payload path');
  }
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

function normalizePriority(value: unknown): WorkItemPriority | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return allowedPriorities.has(value as WorkItemPriority) ? (value as WorkItemPriority) : undefined;
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

function readHeader(headers: WorkItemTriggerInvocationHeaders, headerName: string | null): string | null {
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
