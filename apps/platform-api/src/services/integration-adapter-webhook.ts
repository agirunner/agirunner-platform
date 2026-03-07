import type { AppEnv } from '../config/schema.js';
import { ValidationError } from '../errors/domain-errors.js';
import type { StreamEvent } from './event-stream-service.js';
import { createWebhookSignature } from './webhook-delivery.js';
import { decryptWebhookSecret, encryptWebhookSecret } from './webhook-secret-crypto.js';

export interface DeliveryAttempt {
  attempts: number;
  delivered: boolean;
  lastStatusCode: number | null;
  lastError: string | null;
}

export interface PublicWebhookConfig {
  url: string;
  headers: Record<string, string>;
  secret_configured: boolean;
}

export interface StoredWebhookConfig {
  url: string;
  headers: Record<string, string>;
  secret?: string;
}

export interface WebhookDeliveryTarget {
  url: string;
  secret?: string;
  headers: Record<string, string>;
}

export function matchesSubscription(eventType: string, subscriptions: string[]): boolean {
  if (subscriptions.length === 0) {
    return true;
  }

  return subscriptions.some(
    (entry) => entry === eventType || (entry.endsWith('.*') && eventType.startsWith(`${entry.slice(0, -2)}.`)),
  );
}

export function readWorkflowId(event: StreamEvent): string | null {
  const workflowId = event.data?.workflow_id;
  if (typeof workflowId === 'string' && workflowId.length > 0) {
    return workflowId;
  }

  return event.entity_type === 'workflow' ? event.entity_id : null;
}

export function toPublicWebhookConfig(config: Record<string, unknown>): PublicWebhookConfig {
  const storedConfig = readStoredWebhookConfig(config);
  return {
    url: storedConfig.url,
    headers: storedConfig.headers,
    secret_configured: typeof storedConfig.secret === 'string' && storedConfig.secret.length > 0,
  };
}

export function normalizeStoredWebhookConfig(
  currentConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>,
  encryptionKey: string,
): StoredWebhookConfig {
  const current = readExistingStoredWebhookConfig(currentConfig);
  const url = typeof nextConfig.url === 'string' ? nextConfig.url : current?.url;
  if (!url) {
    throw new ValidationError('Webhook integration adapter requires an http(s) url');
  }
  validateWebhookUrl(url);

  return {
    url,
    headers: nextConfig.headers !== undefined ? normalizeHeaders(nextConfig.headers) : (current?.headers ?? {}),
    ...normalizeSecret(current?.secret, nextConfig.secret, encryptionKey),
  };
}

export function toWebhookDeliveryTarget(
  config: Record<string, unknown>,
  encryptionKey: string,
): WebhookDeliveryTarget {
  const storedConfig = readStoredWebhookConfig(config);
  return {
    url: storedConfig.url,
    secret: decryptSecret(storedConfig.secret, encryptionKey),
    headers: storedConfig.headers,
  };
}

export async function deliverWebhookEvent(
  fetchFn: typeof globalThis.fetch,
  config: AppEnv,
  target: WebhookDeliveryTarget,
  eventType: string,
  payloadData: Record<string, unknown>,
): Promise<DeliveryAttempt> {
  const payload = JSON.stringify(payloadData);

  let attempts = 0;
  let delivered = false;
  let lastStatusCode: number | null = null;
  let lastError: string | null = null;

  while (!delivered && attempts < config.WEBHOOK_MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetchFn(target.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agirunner-event': eventType,
          ...(target.secret
            ? { 'x-agirunner-signature': createWebhookSignature(target.secret, payload) }
            : {}),
          ...target.headers,
        },
        body: payload,
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

    await waitForRetry(config.WEBHOOK_RETRY_BASE_DELAY_MS, attempts);
  }

  return { attempts, delivered, lastStatusCode, lastError };
}

function validateWebhookUrl(url: string): void {
  if (!/^https?:\/\//.test(url)) {
    throw new ValidationError('Webhook integration adapter requires an http(s) url');
  }
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
}

function normalizeSecret(
  currentSecret: string | undefined,
  nextSecret: unknown,
  encryptionKey: string,
): Partial<StoredWebhookConfig> {
  if (nextSecret === undefined) {
    return currentSecret ? { secret: currentSecret } : {};
  }

  if (typeof nextSecret !== 'string' || nextSecret.length < 8) {
    throw new ValidationError('Webhook integration adapter secret must be at least 8 characters');
  }

  return { secret: encryptWebhookSecret(nextSecret, encryptionKey) };
}

function decryptSecret(secret: string | undefined, encryptionKey: string): string | undefined {
  if (!secret) {
    return undefined;
  }

  return decryptWebhookSecret(secret, encryptionKey);
}

function readStoredWebhookConfig(config: Record<string, unknown>): StoredWebhookConfig {
  const url = config.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new ValidationError('Webhook integration adapter requires an http(s) url');
  }

  return {
    url,
    headers: normalizeHeaders(config.headers),
    ...(typeof config.secret === 'string' && config.secret.length > 0 ? { secret: config.secret } : {}),
  };
}

function readExistingStoredWebhookConfig(config: Record<string, unknown>): StoredWebhookConfig | null {
  const url = config.url;
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  return {
    url,
    headers: normalizeHeaders(config.headers),
    ...(typeof config.secret === 'string' && config.secret.length > 0 ? { secret: config.secret } : {}),
  };
}

async function waitForRetry(baseDelayMs: number, attempts: number): Promise<void> {
  const backoffMs = baseDelayMs * 2 ** (attempts - 1);
  await new Promise((resolve) => setTimeout(resolve, backoffMs));
}
