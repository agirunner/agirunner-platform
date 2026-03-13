import type {
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
} from '../../lib/api.js';

export interface TriggerOverviewSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface TriggerOperatorFocusPacket {
  title: string;
  value: string;
  detail: string;
}

export function summarizeTriggerOverview(
  scheduled: DashboardScheduledWorkItemTriggerRecord[],
  webhooks: DashboardWebhookWorkItemTriggerRecord[],
): TriggerOverviewSummaryCard[] {
  const dueScheduled = scheduled.filter((trigger) => describeScheduledTriggerHealth(trigger).label === 'Due').length;
  const disabledScheduled = scheduled.filter((trigger) => !trigger.is_active).length;
  const activeWebhookCount = webhooks.filter((trigger) => trigger.is_active).length;
  const disabledWebhookCount = webhooks.length - activeWebhookCount;

  return [
    {
      label: 'Automation coverage',
      value: scheduled.length > 0 ? `${scheduled.length} rules` : 'No schedules',
      detail:
        scheduled.length === 0
          ? 'No recurring work-item rules configured yet'
          : `${scheduled.filter((trigger) => trigger.is_active).length} active recurring rule${scheduled.filter((trigger) => trigger.is_active).length === 1 ? '' : 's'} across project automation`,
    },
    {
      label: 'Recovery pressure',
      value: dueScheduled + disabledScheduled + disabledWebhookCount > 0 ? `${dueScheduled + disabledScheduled + disabledWebhookCount} need review` : 'Healthy',
      detail:
        dueScheduled > 0
          ? `${dueScheduled} scheduled rule${dueScheduled === 1 ? '' : 's'} should fire now or recover`
          : disabledScheduled + disabledWebhookCount > 0
            ? `${disabledScheduled + disabledWebhookCount} automation rule${disabledScheduled + disabledWebhookCount === 1 ? '' : 's'} are paused and need operator confirmation`
            : 'No scheduled or inbound automation needs recovery',
    },
    {
      label: 'Webhook intake',
      value: webhooks.length > 0 ? `${activeWebhookCount}/${webhooks.length} live` : 'No webhooks',
      detail:
        webhooks.length === 0
          ? 'No inbound webhook triggers configured'
          : `${activeWebhookCount} active inbound webhook trigger${activeWebhookCount === 1 ? '' : 's'}${disabledWebhookCount > 0 ? `, ${disabledWebhookCount} paused` : ''}`,
    },
  ];
}

export function buildTriggerOperatorFocus(
  scheduled: DashboardScheduledWorkItemTriggerRecord[],
  webhooks: DashboardWebhookWorkItemTriggerRecord[],
): TriggerOperatorFocusPacket {
  const dueScheduled = scheduled.filter((trigger) => describeScheduledTriggerHealth(trigger).label === 'Due').length;
  const disabledScheduled = scheduled.filter((trigger) => !trigger.is_active).length;
  const disabledWebhooks = webhooks.filter((trigger) => !trigger.is_active).length;

  if (dueScheduled > 0) {
    return {
      title: 'Recover overdue automation',
      value: `${dueScheduled} due now`,
      detail: 'Open the owning project automation settings and confirm the recurring work-item rule can fire immediately.',
    };
  }
  if (disabledScheduled + disabledWebhooks > 0) {
    return {
      title: 'Review paused automation',
      value: `${disabledScheduled + disabledWebhooks} paused`,
      detail: 'Re-enable schedules or inbound hooks only after validating cadence, board target, and source wiring.',
    };
  }
  return {
    title: 'Automation posture is healthy',
    value: 'No recovery queue',
    detail: 'Recurring and inbound automation are active. Use the owning project settings if scope or cadence changes.',
  };
}

export function describeScheduledTriggerHealth(trigger: DashboardScheduledWorkItemTriggerRecord) {
  if (!trigger.is_active) {
    return { label: 'Disabled', variant: 'secondary' as const };
  }
  if (Date.parse(trigger.next_fire_at) <= Date.now()) {
    return { label: 'Due', variant: 'warning' as const };
  }
  return { label: 'Scheduled', variant: 'success' as const };
}

export function describeScheduledTriggerPacket(trigger: DashboardScheduledWorkItemTriggerRecord) {
  return {
    cadence: formatCadence(trigger.cadence_minutes),
    nextRun: formatDateTime(trigger.next_fire_at),
    source: trigger.source || 'project.schedule',
    nextAction: describeScheduledTriggerNextAction(trigger),
  };
}

export function describeWebhookTriggerPacket(trigger: DashboardWebhookWorkItemTriggerRecord) {
  const activity = describeWebhookTriggerActivity(trigger);
  return {
    source: trigger.source || 'webhook',
    mode: trigger.signature_mode || 'unsigned',
    activity: activity.label,
    nextAction: describeWebhookTriggerNextAction(trigger),
  };
}

export function describeWebhookTriggerActivity(trigger: DashboardWebhookWorkItemTriggerRecord) {
  return trigger.is_active
    ? { label: 'Active', variant: 'success' as const }
    : { label: 'Disabled', variant: 'secondary' as const };
}

export function describeScheduledTriggerNextAction(
  trigger: DashboardScheduledWorkItemTriggerRecord,
): string {
  const health = describeScheduledTriggerHealth(trigger);
  if (health.label === 'Due') {
    return 'Open the owning project and confirm the recurring work-item rule can fire now.';
  }
  if (health.label === 'Disabled') {
    return 'Re-enable only after confirming cadence, board target, and default routing in project automation.';
  }
  return 'Monitor the next run and adjust cadence or defaults from project automation if the work changed.';
}

export function describeWebhookTriggerNextAction(
  trigger: DashboardWebhookWorkItemTriggerRecord,
): string {
  if (!trigger.is_active) {
    return 'Re-enable only after validating signature mode, headers, and source-system wiring.';
  }
  return 'Keep the source system wired to this intake rule and open the owning project if delivery stops.';
}

export function formatCadence(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hr`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `Every ${hours} hr ${remainder} min`;
}

export function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}
