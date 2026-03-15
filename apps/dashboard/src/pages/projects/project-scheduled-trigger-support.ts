import { dashboardApi } from '../../lib/api.js';
import type { DashboardScheduledWorkItemTriggerRecord } from '../../lib/api.js';

export const SCHEDULED_TRIGGER_PRIORITY_OPTIONS = ['critical', 'high', 'normal', 'low'] as const;
export const SCHEDULED_TRIGGER_TIMEZONE_OPTIONS = [
  'UTC',
  'America/Vancouver',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
];
export type ScheduledTriggerScheduleType = 'interval' | 'daily_time';

export interface ScheduledTriggerFormState {
  name: string;
  workflowId: string;
  scheduleType: ScheduledTriggerScheduleType;
  cadenceMinutes: string;
  dailyTime: string;
  timezone: string;
  title: string;
  stageName: string;
  columnId: string;
  priority: string;
  goal: string;
  acceptanceCriteria: string;
  notes: string;
}

export interface ScheduledTriggerFormValidation {
  fieldErrors: {
    name?: string;
    workflowId?: string;
    cadenceMinutes?: string;
    dailyTime?: string;
    timezone?: string;
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
    workflowId: '',
    scheduleType: 'interval',
    cadenceMinutes: '60',
    dailyTime: '09:00',
    timezone: 'UTC',
    title: '',
    stageName: '',
    columnId: '',
    priority: '',
    goal: '',
    acceptanceCriteria: '',
    notes: '',
  };
}

export function hydrateScheduledTriggerForm(
  trigger: DashboardScheduledWorkItemTriggerRecord,
): ScheduledTriggerFormState {
  const defaults = asRecord(trigger.defaults);
  return {
    name: trigger.name,
    workflowId: trigger.workflow_id,
    scheduleType: trigger.schedule_type ?? 'interval',
    cadenceMinutes:
      typeof trigger.cadence_minutes === 'number' ? String(trigger.cadence_minutes) : '60',
    dailyTime: trigger.daily_time ?? '09:00',
    timezone: trigger.timezone ?? 'UTC',
    title: readString(defaults.title),
    stageName: readString(defaults.stage_name),
    columnId: readString(defaults.column_id),
    priority: readString(defaults.priority),
    goal: readString(defaults.goal),
    acceptanceCriteria: readString(defaults.acceptance_criteria),
    notes: readString(defaults.notes),
  };
}

export function buildScheduledTriggerPayload(
  projectId: string,
  form: ScheduledTriggerFormState,
): Parameters<typeof dashboardApi.createScheduledWorkItemTrigger>[0] {
  const defaults: Record<string, unknown> = {
    title: form.title.trim(),
  };
  if (form.stageName.trim()) defaults.stage_name = form.stageName.trim();
  if (form.columnId.trim()) defaults.column_id = form.columnId.trim();
  if (form.priority.trim()) defaults.priority = form.priority.trim();
  if (form.goal.trim()) defaults.goal = form.goal.trim();
  if (form.acceptanceCriteria.trim()) {
    defaults.acceptance_criteria = form.acceptanceCriteria.trim();
  }
  if (form.notes.trim()) defaults.notes = form.notes.trim();

  const payload: Parameters<typeof dashboardApi.createScheduledWorkItemTrigger>[0] = {
    name: form.name.trim(),
    project_id: projectId,
    workflow_id: form.workflowId,
    schedule_type: form.scheduleType,
    defaults,
  };
  if (form.scheduleType === 'interval') {
    const cadenceMinutes = Number(form.cadenceMinutes);
    payload.cadence_minutes =
      Number.isFinite(cadenceMinutes) && cadenceMinutes > 0 ? cadenceMinutes : 60;
  } else {
    payload.cadence_minutes = null;
    payload.daily_time = form.dailyTime.trim();
    payload.timezone = form.timezone.trim();
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
    fieldErrors.workflowId = 'Choose the workflow this trigger should target.';
  }

  if (!form.title.trim()) {
    fieldErrors.title = 'Enter the work item title to create on each run.';
  }

  if (form.scheduleType === 'interval') {
    const cadenceMinutes = Number(form.cadenceMinutes);
    if (!Number.isFinite(cadenceMinutes) || cadenceMinutes <= 0) {
      fieldErrors.cadenceMinutes = 'Enter a cadence greater than 0 minutes.';
    }
  } else {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(form.dailyTime.trim())) {
      fieldErrors.dailyTime = 'Enter a daily time in HH:MM format.';
    }
    if (!form.timezone.trim()) {
      fieldErrors.timezone = 'Choose a timezone for the daily schedule.';
    }
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
        'Create the first schedule, pick the target workflow, and define the work item title before you leave this project.',
      packets: [
        {
          label: 'Schedule coverage',
          value: '0 schedules',
          detail: 'No scheduled work-item automation is active for this project yet.',
        },
        {
          label: 'Attention needed',
          value: '0 items',
          detail: 'No paused or overdue schedules need intervention.',
        },
        {
          label: 'Next trigger',
          value: 'Not scheduled',
          detail: 'Add an interval or daily schedule to start recurring work-item creation.',
        },
      ],
    };
  }

  return {
    heading: dueCount > 0 ? 'Automation attention is needed' : 'Automation posture is healthy',
    summary:
      dueCount > 0
        ? `${dueCount} active schedule${dueCount === 1 ? '' : 's'} should have fired already. Review the related workflow before more overdue work accumulates.`
        : `${activeCount} active schedule${activeCount === 1 ? '' : 's'} are set to keep this project moving without manual launch steps.`,
    nextAction:
      dueCount > 0
        ? 'Review the next due schedule first, then confirm the target workflow, stage, and board column still match the intended automation path.'
        : disabledCount > 0
          ? 'Decide whether the paused schedules should stay dormant or be re-enabled before the next automation window.'
          : 'Check the next upcoming schedule, then edit interval, daily timing, or work-item routing only if the project rhythm has changed.',
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

export function formatSchedule(trigger: Pick<
  DashboardScheduledWorkItemTriggerRecord,
  'schedule_type' | 'cadence_minutes' | 'daily_time' | 'timezone'
>) {
  if (trigger.schedule_type === 'daily_time') {
    const timezone = trigger.timezone ?? 'UTC';
    const dailyTime = trigger.daily_time ?? '--:--';
    return `Daily at ${dailyTime} (${timezone})`;
  }
  return formatCadence(trigger.cadence_minutes ?? 60);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
