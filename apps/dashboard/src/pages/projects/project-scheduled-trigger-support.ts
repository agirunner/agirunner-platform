import { dashboardApi } from '../../lib/api.js';
import type { DashboardScheduledWorkItemTriggerRecord } from '../../lib/api.js';

export const DEFAULT_SCHEDULED_TRIGGER_SOURCE = 'project.schedule';
export const SCHEDULED_TRIGGER_PRIORITY_OPTIONS = ['critical', 'high', 'normal', 'low'] as const;

export interface ScheduledTriggerFormState {
  name: string;
  source: string;
  workflowId: string;
  cadenceMinutes: string;
  title: string;
  stageName: string;
  columnId: string;
  ownerRole: string;
  priority: string;
  goal: string;
  acceptanceCriteria: string;
  notes: string;
  nextFireAt: string;
}

export function createScheduledTriggerFormState(): ScheduledTriggerFormState {
  return {
    name: '',
    source: DEFAULT_SCHEDULED_TRIGGER_SOURCE,
    workflowId: '',
    cadenceMinutes: '60',
    title: '',
    stageName: '',
    columnId: '',
    ownerRole: '',
    priority: '',
    goal: '',
    acceptanceCriteria: '',
    notes: '',
    nextFireAt: '',
  };
}

export function hydrateScheduledTriggerForm(
  trigger: DashboardScheduledWorkItemTriggerRecord,
): ScheduledTriggerFormState {
  const defaults = asRecord(trigger.defaults);
  return {
    name: trigger.name,
    source: trigger.source,
    workflowId: trigger.workflow_id,
    cadenceMinutes: String(trigger.cadence_minutes),
    title: readString(defaults.title),
    stageName: readString(defaults.stage_name),
    columnId: readString(defaults.column_id),
    ownerRole: readString(defaults.owner_role),
    priority: readString(defaults.priority),
    goal: readString(defaults.goal),
    acceptanceCriteria: readString(defaults.acceptance_criteria),
    notes: readString(defaults.notes),
    nextFireAt: toDateTimeLocal(trigger.next_fire_at),
  };
}

export function buildScheduledTriggerPayload(
  projectId: string,
  form: ScheduledTriggerFormState,
): Parameters<typeof dashboardApi.createScheduledWorkItemTrigger>[0] {
  const cadenceMinutes = Number(form.cadenceMinutes);
  const defaults: Record<string, unknown> = {
    title: form.title.trim(),
  };
  if (form.stageName.trim()) defaults.stage_name = form.stageName.trim();
  if (form.columnId.trim()) defaults.column_id = form.columnId.trim();
  if (form.ownerRole.trim()) defaults.owner_role = form.ownerRole.trim();
  if (form.priority.trim()) defaults.priority = form.priority.trim();
  if (form.goal.trim()) defaults.goal = form.goal.trim();
  if (form.acceptanceCriteria.trim()) {
    defaults.acceptance_criteria = form.acceptanceCriteria.trim();
  }
  if (form.notes.trim()) defaults.notes = form.notes.trim();

  const payload: Parameters<typeof dashboardApi.createScheduledWorkItemTrigger>[0] = {
    name: form.name.trim(),
    source: form.source.trim() || DEFAULT_SCHEDULED_TRIGGER_SOURCE,
    project_id: projectId,
    workflow_id: form.workflowId,
    cadence_minutes: Number.isFinite(cadenceMinutes) && cadenceMinutes > 0 ? cadenceMinutes : 60,
    defaults,
  };
  if (form.nextFireAt) {
    payload.next_fire_at = new Date(form.nextFireAt).toISOString();
  }
  return payload;
}

export function canSaveScheduledTrigger(form: ScheduledTriggerFormState): boolean {
  return Boolean(form.name.trim() && form.workflowId && form.title.trim());
}

export function describeTriggerHealth(trigger: DashboardScheduledWorkItemTriggerRecord) {
  if (!trigger.is_active) {
    return { label: 'Disabled', variant: 'secondary' as const };
  }
  if (Date.parse(trigger.next_fire_at) <= Date.now()) {
    return { label: 'Due', variant: 'warning' as const };
  }
  return { label: 'Scheduled', variant: 'success' as const };
}

export function formatCadence(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hr`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `Every ${hours} hr ${remaining} min`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

function toDateTimeLocal(value?: string | null): string {
  if (!value) {
    return '';
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  return new Date(timestamp).toISOString().slice(0, 16);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
