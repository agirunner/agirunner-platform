import { ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import type { CreateWorkItemInput } from './work-item-service.js';

type WorkItemPriority = 'critical' | 'high' | 'normal' | 'low';

export interface ScheduledWorkItemTriggerRow {
  id: string;
  tenant_id: string;
  name: string;
  source: string;
  project_id: string | null;
  workflow_id: string;
  cadence_minutes: number;
  defaults: Record<string, unknown>;
  is_active: boolean;
  last_fired_at: Date | null;
  next_fire_at: Date;
  lease_token: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const allowedPriorities = new Set<WorkItemPriority>(['critical', 'high', 'normal', 'low']);

export function validateScheduledTriggerDefinition(input: {
  name: string;
  source: string;
  workflow_id?: string | null;
  cadence_minutes: number;
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
  if (!Number.isInteger(input.cadence_minutes) || input.cadence_minutes < 1) {
    throw new ValidationError('cadence_minutes must be a positive integer');
  }
  validateDefaults(input.defaults);
}

export function toPublicScheduledTrigger(row: ScheduledWorkItemTriggerRow) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    project_id: row.project_id,
    workflow_id: row.workflow_id,
    cadence_minutes: row.cadence_minutes,
    defaults: sanitizeTriggerDefaults(row.defaults),
    is_active: row.is_active,
    last_fired_at: row.last_fired_at?.toISOString() ?? null,
    next_fire_at: row.next_fire_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function sanitizeTriggerDefaults(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://trigger-secret',
    allowSecretReferences: false,
  });
}

export function buildScheduledWorkItem(
  trigger: ScheduledWorkItemTriggerRow,
  scheduledFor: Date,
): { requestId: string; input: CreateWorkItemInput } {
  const defaults = asRecord(trigger.defaults);
  const title = asString(defaults.title);
  if (!title) {
    throw new ValidationError('Scheduled work item triggers require defaults.title');
  }

  return {
    requestId: `trigger:${trigger.id}:${scheduledFor.toISOString()}`,
    input: {
      title,
      ...(asString(defaults.goal) ? { goal: asString(defaults.goal) } : {}),
      ...(asString(defaults.acceptance_criteria)
        ? { acceptance_criteria: asString(defaults.acceptance_criteria) }
        : {}),
      ...(asString(defaults.stage_name) ? { stage_name: asString(defaults.stage_name) } : {}),
      ...(asString(defaults.column_id) ? { column_id: asString(defaults.column_id) } : {}),
      ...(asString(defaults.owner_role) ? { owner_role: asString(defaults.owner_role) } : {}),
      ...(normalizePriority(defaults.priority) ? { priority: normalizePriority(defaults.priority) } : {}),
      ...(asString(defaults.notes) ? { notes: asString(defaults.notes) } : {}),
      metadata: mergeRecords(asRecord(defaults.metadata), {
        trigger: {
          trigger_id: trigger.id,
          source: trigger.source,
          scheduled_for: scheduledFor.toISOString(),
          trigger_kind: 'schedule',
        },
      }),
    },
  };
}

export function advanceScheduledFireAt(scheduledFor: Date, cadenceMinutes: number): Date {
  return new Date(scheduledFor.getTime() + cadenceMinutes * 60_000);
}

function validateDefaults(defaults: Record<string, unknown>): void {
  const title = asString(defaults.title);
  if (!title) {
    throw new ValidationError('defaults.title is required');
  }
  const priority = defaults.priority;
  if (priority !== undefined && !allowedPriorities.has(priority as WorkItemPriority)) {
    throw new ValidationError('defaults.priority must be a supported priority');
  }
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
