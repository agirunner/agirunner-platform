import { createHash } from 'node:crypto';

import { ValidationError } from '../errors/domain-errors.js';
import type { AppEnv } from '../config/schema.js';
import type { StreamEvent } from './event-stream-service.js';
import {
  decryptIntegrationHeaders,
  normalizeIntegrationHeaders,
  sanitizeIntegrationHeaders,
} from './integration-adapter-headers.js';
import type { DeliveryAttempt } from './integration-adapter-webhook.js';
import type { PlatformTransportTimingDefaults } from './platform-timing-defaults.js';

export interface PublicOtlpConfig {
  endpoint: string;
  headers: Record<string, string>;
  service_name: string;
}

export interface StoredOtlpConfig extends PublicOtlpConfig {}

export interface OtlpDeliveryTarget {
  endpoint: string;
  headers: Record<string, string>;
  serviceName: string;
}

type OtlpDeliveryConfig = AppEnv & PlatformTransportTimingDefaults;

export function normalizeStoredOtlpConfig(
  currentConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>,
  encryptionKey: string,
): StoredOtlpConfig {
  const current = readExistingOtlpConfig(currentConfig);
  const endpoint = typeof nextConfig.endpoint === 'string' ? nextConfig.endpoint : current?.endpoint;
  if (!endpoint) {
    throw new ValidationError('OTLP integration adapter requires endpoint');
  }

  validateEndpoint(endpoint);
  return {
    endpoint,
    headers:
      nextConfig.headers !== undefined
        ? normalizeIntegrationHeaders(nextConfig.headers, encryptionKey, current?.headers ?? {})
        : (current?.headers ?? {}),
    service_name:
      typeof nextConfig.service_name === 'string'
        ? nextConfig.service_name
        : (current?.service_name ?? 'agirunner-platform'),
  };
}

export function toPublicOtlpConfig(config: Record<string, unknown>): PublicOtlpConfig {
  const stored = readStoredOtlpConfig(config);
  return {
    endpoint: stored.endpoint,
    headers: sanitizeIntegrationHeaders(stored.headers),
    service_name: stored.service_name,
  };
}

export function toOtlpDeliveryTarget(
  config: Record<string, unknown>,
  encryptionKey: string,
): OtlpDeliveryTarget {
  const stored = readStoredOtlpConfig(config);
  return {
    endpoint: stored.endpoint,
    headers: decryptIntegrationHeaders(stored.headers, encryptionKey),
    serviceName: stored.service_name,
  };
}

export async function deliverOtlpEvent(
  fetchFn: typeof globalThis.fetch,
  config: OtlpDeliveryConfig,
  target: OtlpDeliveryTarget,
  event: StreamEvent,
): Promise<DeliveryAttempt> {
  const body = JSON.stringify(buildTraceEnvelope(target.serviceName, event));

  let attempts = 0;
  let delivered = false;
  let lastStatusCode: number | null = null;
  let lastError: string | null = null;

  while (!delivered && attempts < config.WEBHOOK_MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const response = await fetchFn(target.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...target.headers,
        },
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

function buildTraceEnvelope(serviceName: string, event: StreamEvent) {
  const workflowId = readWorkflowId(event);
  const traceId = hashHex(workflowId ?? `${event.tenant_id}:${event.entity_id}`, 32);
  const spanId = hashHex(`${event.id}:${event.type}`, 16);
  const parentSpanId = workflowId && event.entity_type === 'task' ? hashHex(workflowId, 16) : undefined;
  const timeUnixNano = `${Date.parse(event.created_at) * 1_000_000}`;
  const attributes = buildAttributes(event, workflowId);

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            { key: 'agirunner.tenant.id', value: { stringValue: event.tenant_id } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'agirunner.platform.integration.otlp' },
            spans: [
              {
                traceId,
                spanId,
                ...(parentSpanId ? { parentSpanId } : {}),
                name: event.type,
                kind: 1,
                startTimeUnixNano: timeUnixNano,
                endTimeUnixNano: timeUnixNano,
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildAttributes(event: StreamEvent, workflowId: string | null) {
  const attributes = [
    { key: 'agirunner.workflow.id', value: { stringValue: workflowId ?? '' } },
    { key: 'agirunner.task.id', value: { stringValue: event.entity_type === 'task' ? event.entity_id : '' } },
    { key: 'agirunner.task.role', value: { stringValue: readStringField(event.data, 'role') ?? '' } },
    { key: 'agirunner.task.state', value: { stringValue: readStringField(event.data, 'to_state') ?? '' } },
    { key: 'agirunner.agent.id', value: { stringValue: readStringField(event.data, 'agent_id') ?? '' } },
    {
      key: 'agirunner.agent.framework',
      value: { stringValue: readStringField(event.data, 'agent_framework') ?? '' },
    },
    { key: 'gen_ai.system', value: { stringValue: readStringField(event.data, 'gen_ai_system') ?? 'agirunner' } },
    {
      key: 'gen_ai.request.model',
      value: { stringValue: readStringField(event.data, 'gen_ai_model') ?? '' },
    },
    { key: 'agirunner.event.type', value: { stringValue: event.type } },
  ];

  return attributes.filter((entry) => entry.value.stringValue.length > 0);
}

function readWorkflowId(event: StreamEvent): string | null {
  const workflowId = event.data?.workflow_id;
  if (typeof workflowId === 'string' && workflowId.length > 0) {
    return workflowId;
  }
  return event.entity_type === 'workflow' ? event.entity_id : null;
}

function readStringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readStoredOtlpConfig(config: Record<string, unknown>): StoredOtlpConfig {
  const endpoint = config.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new ValidationError('OTLP integration adapter requires endpoint');
  }

  validateEndpoint(endpoint);
  return {
    endpoint,
    headers: readStoredHeaders(config.headers),
    service_name:
      typeof config.service_name === 'string' && config.service_name.length > 0
        ? config.service_name
        : 'agirunner-platform',
  };
}

function readExistingOtlpConfig(config: Record<string, unknown>): StoredOtlpConfig | null {
  const endpoint = config.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    return null;
  }

  return readStoredOtlpConfig(config);
}

function readStoredHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
}

function validateEndpoint(endpoint: string): void {
  if (!/^https?:\/\//.test(endpoint)) {
    throw new ValidationError('OTLP integration adapter requires an http(s) endpoint');
  }
}

function hashHex(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}
