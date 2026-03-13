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

export interface ScheduledTriggerFormValidation {
  fieldErrors: {
    name?: string;
    workflowId?: string;
    cadenceMinutes?: string;
    title?: string;
  };
  issues: string[];
  isValid: boolean;
}

export interface ScheduledTriggerOverviewPacket {
  label: string;
  value: string;
  detail: string;
}

export interface ScheduledTriggerOverview {
  heading: string;
  summary: string;
  nextAction: string;
  packets: ScheduledTriggerOverviewPacket[];
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
  return validateScheduledTriggerForm(form).isValid;
}

export function validateScheduledTriggerForm(
  form: ScheduledTriggerFormState,
): ScheduledTriggerFormValidation {
  const fieldErrors: ScheduledTriggerFormValidation['fieldErrors'] = {};

  if (!form.name.trim()) {
    fieldErrors.name = 'Enter a schedule name.';
  }

  if (!form.workflowId.trim()) {
    fieldErrors.workflowId = 'Choose the run this trigger should target.';
  }

  if (!form.title.trim()) {
    fieldErrors.title = 'Enter the work item title to create on each run.';
  }

  const cadenceMinutes = Number(form.cadenceMinutes);
  if (!Number.isFinite(cadenceMinutes) || cadenceMinutes <= 0) {
    fieldErrors.cadenceMinutes = 'Enter a cadence greater than 0 minutes.';
  }

  const issues = Object.values(fieldErrors);
  return {
    fieldErrors,
    issues,
    isValid: issues.length === 0,
  };
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

export function buildScheduledTriggerOverview(
  triggers: DashboardScheduledWorkItemTriggerRecord[],
): ScheduledTriggerOverview {
  const activeCount = triggers.filter((trigger) => trigger.is_active).length;
  const disabledCount = triggers.length - activeCount;
  const dueCount = triggers.filter(
    (trigger) => trigger.is_active && Date.parse(trigger.next_fire_at) <= Date.now(),
  ).length;
  const nextTrigger = [...triggers]
    .filter((trigger) => trigger.is_active)
    .sort((left, right) => Date.parse(left.next_fire_at) - Date.parse(right.next_fire_at))[0];

  if (triggers.length === 0) {
    return {
      heading: 'No schedules are configured yet',
      summary:
        'Scheduled work-item automation is empty for this project. Add the first schedule to create recurring work and wake the orchestrator through the normal activation flow.',
      nextAction:
        'Create the first schedule, pick the target run, and define the work item title before you leave this project.',
      packets: [
        {
          label: 'Schedule coverage',
          value: '0 schedules',
          detail: 'No recurring work-item automation is active for this project yet.',
        },
        {
          label: 'Attention needed',
          value: '0 items',
          detail: 'No paused or overdue schedules need intervention.',
        },
        {
          label: 'Next trigger',
          value: 'Not scheduled',
          detail: 'Add a cadence to start recurring work-item creation.',
        },
      ],
    };
  }

  return {
    heading: dueCount > 0 ? 'Automation attention is needed' : 'Automation posture is healthy',
    summary:
      dueCount > 0
        ? `${dueCount} active schedule${dueCount === 1 ? '' : 's'} should have fired already. Review the related run before more overdue work accumulates.`
        : `${activeCount} active schedule${activeCount === 1 ? '' : 's'} are set to keep this project moving without manual launch steps.`,
    nextAction:
      dueCount > 0
        ? 'Review the next due schedule first, then confirm the target run, stage, and owner role still match the intended automation path.'
        : disabledCount > 0
          ? 'Decide whether the paused schedules should stay dormant or be re-enabled before the next automation window.'
          : 'Check the next upcoming schedule, then edit cadence or ownership only if the current project rhythm has changed.',
    packets: [
      {
        label: 'Schedule coverage',
        value: `${triggers.length} schedules`,
        detail: `${activeCount} active • ${disabledCount} paused`,
      },
      {
        label: 'Attention needed',
        value: `${dueCount} due`,
        detail:
          dueCount > 0
            ? 'At least one active schedule is overdue and should be reviewed.'
            : 'No active schedule is currently overdue.',
      },
      {
        label: 'Next trigger',
        value: nextTrigger ? formatDateTime(nextTrigger.next_fire_at) : 'Paused',
        detail: nextTrigger
          ? `${nextTrigger.name} is the next active schedule to fire.`
          : 'All schedules are paused right now.',
      },
    ],
  };
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
