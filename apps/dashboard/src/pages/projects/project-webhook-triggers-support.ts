import type { DashboardWebhookWorkItemTriggerRecord } from '../../lib/api.js';

export interface WebhookTriggerOverviewPacket {
  label: string;
  value: string;
  detail: string;
}

export interface WebhookTriggerOverview {
  heading: string;
  summary: string;
  nextAction: string;
  packets: WebhookTriggerOverviewPacket[];
}

export function buildWebhookTriggerOverview(
  triggers: DashboardWebhookWorkItemTriggerRecord[],
): WebhookTriggerOverview {
  const activeCount = triggers.filter((trigger) => trigger.is_active).length;
  const disabledCount = triggers.length - activeCount;
  const secretMissing = triggers.filter(
    (trigger) => trigger.is_active && !trigger.secret_configured,
  ).length;

  if (triggers.length === 0) {
    return {
      heading: 'No webhook triggers are configured yet',
      summary:
        'Inbound webhook automation is empty for this project. Add the first webhook trigger to start receiving external events as work items.',
      nextAction:
        'Create the first webhook trigger, choose the target workflow, and configure the source signature before you leave this project.',
      packets: [
        {
          label: 'Webhook coverage',
          value: '0 triggers',
          detail: 'No inbound webhook triggers are active for this project yet.',
        },
        {
          label: 'Attention needed',
          value: '0 items',
          detail: 'No paused or misconfigured webhook triggers need intervention.',
        },
        {
          label: 'Source wiring',
          value: 'Not configured',
          detail: 'Add a trigger to start accepting external webhook payloads.',
        },
      ],
    };
  }

  const needsReview = disabledCount + secretMissing;

  return {
    heading:
      needsReview > 0
        ? 'Webhook attention is needed'
        : 'Webhook posture is healthy',
    summary:
      disabledCount > 0
        ? `${disabledCount} webhook trigger${disabledCount === 1 ? '' : 's'} ${disabledCount === 1 ? 'is' : 'are'} paused. Review source wiring and signature configuration before re-enabling.`
        : secretMissing > 0
          ? `${secretMissing} active trigger${secretMissing === 1 ? '' : 's'} may lack signature verification. Confirm the secret is configured.`
          : `${activeCount} active webhook trigger${activeCount === 1 ? '' : 's'} ${activeCount === 1 ? 'is' : 'are'} receiving external events for this project.`,
    nextAction:
      disabledCount > 0
        ? 'Decide whether the paused triggers should stay dormant or be re-enabled after validating source-system wiring.'
        : secretMissing > 0
          ? 'Review and set secrets on triggers that lack signature verification before external traffic arrives.'
          : 'Monitor intake and adjust field mappings or defaults only if the source event schema has changed.',
    packets: [
      {
        label: 'Webhook coverage',
        value: `${triggers.length} trigger${triggers.length === 1 ? '' : 's'}`,
        detail: `${activeCount} active • ${disabledCount} paused`,
      },
      {
        label: 'Attention needed',
        value:
          needsReview > 0
            ? `${needsReview} need review`
            : 'Healthy',
        detail:
          disabledCount > 0
            ? `${disabledCount} trigger${disabledCount === 1 ? '' : 's'} ${disabledCount === 1 ? 'is' : 'are'} paused and need${disabledCount === 1 ? 's' : ''} operator confirmation.`
            : secretMissing > 0
              ? `${secretMissing} active trigger${secretMissing === 1 ? '' : 's'} may lack a configured secret.`
              : 'No webhook triggers currently need intervention.',
      },
      {
        label: 'Source wiring',
        value: activeCount > 0 ? `${activeCount} live` : 'All paused',
        detail:
          activeCount > 0
            ? `${activeCount} trigger${activeCount === 1 ? '' : 's'} ${activeCount === 1 ? 'is' : 'are'} accepting inbound webhook payloads.`
            : 'All webhook triggers are currently paused.',
      },
    ],
  };
}
