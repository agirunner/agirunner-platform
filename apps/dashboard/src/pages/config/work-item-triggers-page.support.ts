import type {
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
} from '../../lib/api.js';

export interface TriggerOverviewSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export function summarizeTriggerOverview(
  scheduled: DashboardScheduledWorkItemTriggerRecord[],
  webhooks: DashboardWebhookWorkItemTriggerRecord[],
): TriggerOverviewSummaryCard[] {
  const dueScheduled = scheduled.filter((trigger) => describeScheduledTriggerHealth(trigger).label === 'Due').length;
  const activeWebhookCount = webhooks.filter((trigger) => trigger.is_active).length;

  return [
    {
      label: 'Scheduled rules',
      value: String(scheduled.length),
      detail:
        scheduled.length === 0
          ? 'No recurring work-item rules configured yet'
          : `${scheduled.filter((trigger) => trigger.is_active).length} active automation rule${scheduled.filter((trigger) => trigger.is_active).length === 1 ? '' : 's'}`,
    },
    {
      label: 'Needs attention',
      value: dueScheduled > 0 ? `${dueScheduled} due` : 'Healthy',
      detail:
        dueScheduled > 0
          ? `${dueScheduled} scheduled rule${dueScheduled === 1 ? '' : 's'} should fire now or recover`
          : 'No scheduled rules are overdue',
    },
    {
      label: 'Webhook intake',
      value: String(webhooks.length),
      detail:
        webhooks.length === 0
          ? 'No inbound webhook triggers configured'
          : `${activeWebhookCount} active inbound webhook trigger${activeWebhookCount === 1 ? '' : 's'}`,
    },
  ];
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
  };
}

export function describeWebhookTriggerPacket(trigger: DashboardWebhookWorkItemTriggerRecord) {
  return {
    source: trigger.source || 'webhook',
    mode: trigger.signature_mode || 'unsigned',
    activity: trigger.is_active ? 'Active' : 'Disabled',
  };
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
