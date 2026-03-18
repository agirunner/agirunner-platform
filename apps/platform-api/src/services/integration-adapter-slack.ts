import { ValidationError } from '../errors/domain-errors.js';
import type { AppEnv } from '../config/schema.js';
import type { DeliveryAttempt } from './integration-adapter-webhook.js';
import type { PlatformTransportTimingDefaults } from './platform-timing-defaults.js';
import { decryptWebhookSecret, encryptWebhookSecret } from './webhook-secret-crypto.js';

export interface PublicSlackConfig {
  webhook_url_configured: boolean;
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

export interface StoredSlackConfig {
  webhook_url: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

interface SlackActionLink {
  url: string;
}

interface SlackApprovalActions {
  approve?: SlackActionLink;
  reject?: SlackActionLink;
}

export interface SlackDeliveryTarget {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

type SlackDeliveryConfig = AppEnv & PlatformTransportTimingDefaults;

export function normalizeStoredSlackConfig(
  currentConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>,
  encryptionKey: string,
): StoredSlackConfig {
  const current = readExistingSlackConfig(currentConfig, encryptionKey);
  const webhookUrl =
    typeof nextConfig.webhook_url === 'string' ? nextConfig.webhook_url : current?.webhook_url;
  if (!webhookUrl) {
    throw new ValidationError('Slack integration adapter requires webhook_url');
  }

  validateWebhookUrl(webhookUrl);
  return {
    webhook_url: encryptWebhookSecret(webhookUrl, encryptionKey),
    ...(typeof nextConfig.channel === 'string'
      ? { channel: nextConfig.channel }
      : current?.channel
        ? { channel: current.channel }
        : {}),
    ...(typeof nextConfig.username === 'string'
      ? { username: nextConfig.username }
      : current?.username
        ? { username: current.username }
        : {}),
    ...(typeof nextConfig.icon_emoji === 'string'
      ? { icon_emoji: nextConfig.icon_emoji }
      : current?.icon_emoji
        ? { icon_emoji: current.icon_emoji }
        : {}),
  };
}

export function toPublicSlackConfig(config: Record<string, unknown>): PublicSlackConfig {
  const stored = readStoredSlackConfig(config);
  return {
    webhook_url_configured: stored.webhook_url.length > 0,
    ...(stored.channel ? { channel: stored.channel } : {}),
    ...(stored.username ? { username: stored.username } : {}),
    ...(stored.icon_emoji ? { icon_emoji: stored.icon_emoji } : {}),
  };
}

export function toSlackDeliveryTarget(
  config: Record<string, unknown>,
  encryptionKey: string,
): SlackDeliveryTarget {
  const stored = readStoredSlackConfig(config);
  const webhookUrl = decryptWebhookSecret(stored.webhook_url, encryptionKey);
  validateWebhookUrl(webhookUrl);
  return {
    webhookUrl,
    channel: stored.channel,
    username: stored.username,
    iconEmoji: stored.icon_emoji,
  };
}

export async function deliverSlackEvent(
  fetchFn: typeof globalThis.fetch,
  config: SlackDeliveryConfig,
  target: SlackDeliveryTarget,
  payloadData: Record<string, unknown>,
): Promise<DeliveryAttempt> {
  const slackPayload = buildSlackPayload(payloadData, target);
  const body = JSON.stringify(slackPayload);

  let attempts = 0;
  let delivered = false;
  let lastStatusCode: number | null = null;
  let lastError: string | null = null;

  while (!delivered && attempts < config.WEBHOOK_MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetchFn(target.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      lastStatusCode = response.status;
      if (response.ok) {
        delivered = true;
        break;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.WEBHOOK_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1)),
    );
  }

  return { attempts, delivered, lastStatusCode, lastError };
}

function buildSlackPayload(payloadData: Record<string, unknown>, target: SlackDeliveryTarget) {
  const approvalActions = readApprovalActions(payloadData.approval_actions);
  const summary = buildSummaryText(payloadData);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: summary },
    },
  ];

  if (approvalActions.approve?.url || approvalActions.reject?.url) {
    blocks.push({
      type: 'actions',
      elements: [
        ...(approvalActions.approve?.url
          ? [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Approve' },
                style: 'primary',
                url: approvalActions.approve.url,
              },
            ]
          : []),
        ...(approvalActions.reject?.url
          ? [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Reject' },
                style: 'danger',
                url: approvalActions.reject.url,
              },
            ]
          : []),
      ],
    });
  }

  return {
    text: summary,
    blocks,
    ...(target.channel ? { channel: target.channel } : {}),
    ...(target.username ? { username: target.username } : {}),
    ...(target.iconEmoji ? { icon_emoji: target.iconEmoji } : {}),
  };
}

function buildSummaryText(payloadData: Record<string, unknown>): string {
  const eventType = typeof payloadData.type === 'string' ? payloadData.type : 'event';
  const entityType = typeof payloadData.entity_type === 'string' ? payloadData.entity_type : 'entity';
  const entityId = typeof payloadData.entity_id === 'string' ? payloadData.entity_id : 'unknown';
  const toState = readTargetState(payloadData.data);

  if (eventType === 'task.state_changed' && toState === 'awaiting_approval') {
    return `Task \`${entityId}\` is awaiting approval.`;
  }

  return `${entityType} \`${entityId}\` emitted \`${eventType}\`.`;
}

function readTargetState(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }

  const toState = (data as Record<string, unknown>).to_state;
  return typeof toState === 'string' ? toState : undefined;
}

function readApprovalActions(value: unknown): SlackApprovalActions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const actions = value as Record<string, unknown>;
  return {
    approve: readAction(actions.approve),
    reject: readAction(actions.reject),
  };
}

function readAction(value: unknown): SlackActionLink | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const url = (value as Record<string, unknown>).url;
  return typeof url === 'string' ? { url } : undefined;
}

function readStoredSlackConfig(config: Record<string, unknown>): StoredSlackConfig {
  const webhookUrl = config.webhook_url;
  if (typeof webhookUrl !== 'string' || webhookUrl.length === 0) {
    throw new ValidationError('Slack integration adapter requires webhook_url');
  }

  return {
    webhook_url: webhookUrl,
    ...(typeof config.channel === 'string' ? { channel: config.channel } : {}),
    ...(typeof config.username === 'string' ? { username: config.username } : {}),
    ...(typeof config.icon_emoji === 'string' ? { icon_emoji: config.icon_emoji } : {}),
  };
}

function readExistingSlackConfig(
  config: Record<string, unknown>,
  encryptionKey: string,
): Omit<StoredSlackConfig, 'webhook_url'> & { webhook_url: string } | null {
  const webhookUrl = config.webhook_url;
  if (typeof webhookUrl !== 'string' || webhookUrl.length === 0) {
    return null;
  }

  return {
    ...readStoredSlackConfig(config),
    webhook_url: decryptWebhookSecret(webhookUrl, encryptionKey),
  };
}

function validateWebhookUrl(url: string): void {
  if (!/^https?:\/\//.test(url)) {
    throw new ValidationError('Slack integration adapter requires an http(s) webhook_url');
  }
}
