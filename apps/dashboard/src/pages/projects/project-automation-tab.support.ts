import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
} from '../../lib/api.js';

export interface ProjectAutomationOverviewPacket {
  label: string;
  value: string;
  detail: string;
}

export interface ProjectAutomationOverviewSignal {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'secondary';
}

export interface ProjectAutomationOverview {
  statusLabel: string;
  tone: 'success' | 'warning';
  summary: string;
  nextAction: string;
  signals: ProjectAutomationOverviewSignal[];
  packets: ProjectAutomationOverviewPacket[];
}

export function buildProjectAutomationOverview(
  project: DashboardProjectRecord,
  scheduledTriggers: DashboardScheduledWorkItemTriggerRecord[],
  webhookTriggers: DashboardWebhookWorkItemTriggerRecord[],
  now: Date = new Date(),
): ProjectAutomationOverview {
  const activeSchedules = scheduledTriggers.filter((trigger) => trigger.is_active);
  const activeWebhookTriggers = webhookTriggers.filter((trigger) => trigger.is_active);
  const overdueSchedules = activeSchedules.filter(
    (trigger) => Date.parse(trigger.next_fire_at) <= now.getTime(),
  );
  const webhookSecretsMissing = activeWebhookTriggers.filter(
    (trigger) => !trigger.secret_configured,
  );
  const activeLaneCount = activeSchedules.length + activeWebhookTriggers.length;
  const brokenCount = overdueSchedules.length + webhookSecretsMissing.length;
  const setupItems = [
    scheduledTriggers.length === 0 ? 'Schedules' : null,
    webhookTriggers.length === 0 ? 'Inbound hooks' : null,
    needsRepositorySignatureSetup(project) ? 'Repository signatures' : null,
  ].filter((value): value is string => value !== null);

  const statusLabel =
    brokenCount > 0
      ? 'Automation needs attention'
      : setupItems.length > 0
        ? 'Automation setup is incomplete'
        : 'Automation is live';
  const tone = brokenCount > 0 || setupItems.length > 0 ? 'warning' : 'success';

  return {
    statusLabel,
    tone,
    summary:
      brokenCount > 0
        ? buildBrokenSummary(overdueSchedules.length, webhookSecretsMissing.length)
        : setupItems.length > 0
          ? `Finish ${joinLabels(setupItems)} so schedules, inbound hooks, and repository signatures behave like one control center.`
          : `Schedules, inbound hooks, and repository signatures are aligned for this project with ${formatCount(activeLaneCount, 'live lane')}.`,
    nextAction:
      overdueSchedules.length > 0
        ? 'Start with the overdue schedule, then confirm inbound hooks and repository signatures still point at the intended run.'
        : webhookSecretsMissing.length > 0
          ? 'Set the missing inbound-hook secret before the next external event arrives.'
          : setupItems.includes('Repository signatures')
            ? 'Configure repository signatures before operators rely on source-driven automation.'
            : setupItems.length > 0
            ? `Finish ${joinLabels(setupItems)} next, then keep edits in place from this control center.`
              : 'Automation is healthy. Only change cadence, defaults, or hook mappings when the project workflow changes.',
    signals: [
      {
        label: 'Live',
        value: activeLaneCount > 0 ? `${activeLaneCount} live` : '0 live',
        tone: activeLaneCount > 0 ? 'success' : 'secondary',
      },
      {
        label: 'Attention',
        value: brokenCount > 0 ? `${brokenCount} issues` : 'Clear',
        tone: brokenCount > 0 ? 'warning' : 'success',
      },
      {
        label: 'Setup',
        value:
          setupItems.length > 0
            ? `${setupItems.length} ${setupItems.length === 1 ? 'gap' : 'gaps'}`
            : 'Ready',
        tone: setupItems.length > 0 ? 'warning' : 'success',
      },
    ],
    packets: [
      {
        label: 'Active now',
        value:
          activeLaneCount > 0 ? `${activeLaneCount} lanes live` : 'No live lanes',
        detail:
          activeLaneCount > 0
            ? `${formatCount(activeSchedules.length, 'active schedule')} and ${formatCount(activeWebhookTriggers.length, 'active hook')} are currently moving work into this project.`
            : 'No active schedules or inbound hooks are currently feeding this project.',
      },
      {
        label: 'Broken',
        value: brokenCount > 0 ? `${brokenCount} issues` : 'No active breakage',
        detail:
          brokenCount > 0
            ? buildBrokenSummary(overdueSchedules.length, webhookSecretsMissing.length)
            : 'No overdue schedules or misconfigured active inbound hooks need operator repair right now.',
      },
      {
        label: 'Setup needed',
        value:
          setupItems.length > 0 ? `${setupItems.length} ${setupItems.length === 1 ? 'item' : 'items'}` : 'Ready',
        detail:
          setupItems.length > 0
            ? `${joinLabels(setupItems)} still ${setupItems.length === 1 ? 'needs' : 'need'} setup before this control center is fully ready.`
            : 'Schedules, inbound hooks, and repository signatures are configured for normal operator use.',
      },
    ],
  };
}

function needsRepositorySignatureSetup(project: DashboardProjectRecord): boolean {
  if (!project.repository_url) {
    return true;
  }
  if (!project.git_webhook_provider) {
    return true;
  }
  return !project.git_webhook_secret_configured;
}

function buildBrokenSummary(
  overdueScheduleCount: number,
  missingWebhookSecretCount: number,
): string {
  const parts = [
    overdueScheduleCount > 0
      ? `${formatCount(overdueScheduleCount, 'overdue schedule')}`
      : null,
    missingWebhookSecretCount > 0
      ? `${formatCount(missingWebhookSecretCount, 'active inbound hook')} missing signature secrets`
      : null,
  ].filter((value): value is string => value !== null);

  return parts.length > 0
    ? `${joinLabels(parts)} need operator repair.`
    : 'No overdue schedules or misconfigured active inbound hooks need operator repair right now.';
}

function formatCount(count: number, label: string): string {
  return `${count} ${count === 1 ? label : `${label}s`}`;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? '';
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}
