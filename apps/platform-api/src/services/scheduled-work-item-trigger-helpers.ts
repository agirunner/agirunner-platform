import { ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import type { CreateWorkItemInput } from './work-item-service.js';

type WorkItemPriority = 'critical' | 'high' | 'normal' | 'low';
export type ScheduledTriggerScheduleType = 'interval' | 'daily_time';

export interface ScheduledWorkItemTriggerRow {
  id: string;
  tenant_id: string;
  name: string;
  source: string;
  workspace_id: string | null;
  workflow_id: string;
  schedule_type: ScheduledTriggerScheduleType;
  cadence_minutes: number | null;
  daily_time: string | null;
  timezone: string | null;
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
const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateScheduledTriggerDefinition(input: {
  name: string;
  source: string;
  workflow_id?: string | null;
  schedule_type?: ScheduledTriggerScheduleType | null;
  cadence_minutes?: number | null;
  daily_time?: string | null;
  timezone?: string | null;
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
  const scheduleType = normalizeScheduleType(input.schedule_type);
  if (scheduleType === 'interval') {
    if (!Number.isInteger(input.cadence_minutes) || Number(input.cadence_minutes) < 1) {
      throw new ValidationError('cadence_minutes must be a positive integer');
    }
    if (asString(input.daily_time) || asString(input.timezone)) {
      throw new ValidationError('daily_time and timezone are only valid for daily_time schedules');
    }
  } else {
    const dailyTime = asString(input.daily_time);
    if (!dailyTime) {
      throw new ValidationError('daily_time is required for daily_time schedules');
    }
    if (!DAILY_TIME_PATTERN.test(dailyTime)) {
      throw new ValidationError('daily_time must use HH:MM 24-hour format');
    }
    const timezone = asString(input.timezone);
    if (!timezone) {
      throw new ValidationError('timezone is required for daily_time schedules');
    }
    assertValidTimeZone(timezone);
    if (input.cadence_minutes != null) {
      throw new ValidationError('cadence_minutes must be omitted for daily_time schedules');
    }
  }
  validateDefaults(input.defaults);
}

export function toPublicScheduledTrigger(row: ScheduledWorkItemTriggerRow) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    workspace_id: row.workspace_id,
    workflow_id: row.workflow_id,
    schedule_type: row.schedule_type,
    cadence_minutes: row.cadence_minutes,
    daily_time: row.daily_time,
    timezone: row.timezone,
    defaults: sanitizeTriggerDefaults(row.defaults),
    is_active: row.is_active,
    last_fired_at: row.last_fired_at?.toISOString() ?? null,
    next_fire_at: row.next_fire_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function sanitizeTriggerDefaults(value: unknown) {
  const sanitized = sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://trigger-secret',
    allowSecretReferences: false,
  });
  delete sanitized.owner_role;
  return sanitized;
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

export function advanceScheduledFireAt(trigger: Pick<
  ScheduledWorkItemTriggerRow,
  'schedule_type' | 'cadence_minutes' | 'daily_time' | 'timezone'
>, scheduledFor: Date): Date {
  const scheduleType = normalizeScheduleType(trigger.schedule_type);
  if (scheduleType === 'interval') {
    const cadenceMinutes = trigger.cadence_minutes;
    if (!Number.isInteger(cadenceMinutes) || Number(cadenceMinutes) < 1) {
      throw new ValidationError('cadence_minutes must be a positive integer');
    }
    return new Date(scheduledFor.getTime() + Number(cadenceMinutes) * 60_000);
  }

  const dailyTime = asString(trigger.daily_time);
  const timezone = asString(trigger.timezone);
  if (!dailyTime || !timezone) {
    throw new ValidationError('daily_time schedules require daily_time and timezone');
  }
  return computeNextDailyTime(dailyTime, timezone, scheduledFor);
}

export function computeInitialScheduledFireAt(input: {
  schedule_type?: ScheduledTriggerScheduleType | null;
  cadence_minutes?: number | null;
  daily_time?: string | null;
  timezone?: string | null;
}, now = new Date()): Date {
  const scheduleType = normalizeScheduleType(input.schedule_type);
  if (scheduleType === 'interval') {
    const cadenceMinutes = input.cadence_minutes;
    if (!Number.isInteger(cadenceMinutes) || Number(cadenceMinutes) < 1) {
      throw new ValidationError('cadence_minutes must be a positive integer');
    }
    return new Date(now.getTime() + Number(cadenceMinutes) * 60_000);
  }

  const dailyTime = asString(input.daily_time);
  const timezone = asString(input.timezone);
  if (!dailyTime || !timezone) {
    throw new ValidationError('daily_time schedules require daily_time and timezone');
  }
  return computeNextDailyTime(dailyTime, timezone, now);
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

function normalizeScheduleType(value: ScheduledTriggerScheduleType | string | null | undefined) {
  return value === 'daily_time' ? 'daily_time' : 'interval';
}

function assertValidTimeZone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    throw new ValidationError('timezone must be a valid IANA timezone');
  }
}

function computeNextDailyTime(dailyTime: string, timezone: string, after: Date): Date {
  const match = DAILY_TIME_PATTERN.exec(dailyTime);
  if (!match) {
    throw new ValidationError('daily_time must use HH:MM 24-hour format');
  }
  assertValidTimeZone(timezone);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  let localDate = getLocalDateParts(after, timezone);
  let candidate = zonedDateTimeToUtc(localDate.year, localDate.month, localDate.day, hour, minute, timezone);
  if (candidate.getTime() <= after.getTime()) {
    localDate = addCalendarDays(localDate, 1);
    candidate = zonedDateTimeToUtc(localDate.year, localDate.month, localDate.day, hour, minute, timezone);
  }
  return candidate;
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let date = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timezone));
  const adjustedOffset = getTimeZoneOffsetMs(date, timezone);
  date = new Date(utcGuess - adjustedOffset);
  return date;
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = getDateTimeParts(date, timezone);
  const utcFromTzView = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return utcFromTzView - date.getTime();
}

function getLocalDateParts(date: Date, timezone: string) {
  const parts = getDateTimeParts(date, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function getDateTimeParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  return {
    year: Number(readPart(parts, 'year')),
    month: Number(readPart(parts, 'month')),
    day: Number(readPart(parts, 'day')),
    hour: Number(readPart(parts, 'hour')),
    minute: Number(readPart(parts, 'minute')),
    second: Number(readPart(parts, 'second')),
  };
}

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  const match = parts.find((part) => part.type === type)?.value;
  if (!match) {
    throw new ValidationError(`Could not read ${type} for scheduled trigger timezone conversion`);
  }
  return match;
}

function addCalendarDays(
  value: { year: number; month: number; day: number },
  days: number,
) {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + days, 12, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
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
