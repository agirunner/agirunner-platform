import { randomUUID } from 'node:crypto';

import type { LogService } from './log-service.js';

export type AuthEventType =
  | 'login' | 'login_failed'
  | 'logout'
  | 'token_refresh' | 'token_refresh_failed'
  | 'sso_callback' | 'sso_callback_failed'
  | 'api_key_exchange' | 'api_key_exchange_failed';

export interface AuthEventInput {
  tenantId: string;
  type: AuthEventType;
  method: string;
  actorType: string;
  actorId: string;
  actorName: string;
  metadata?: Record<string, unknown>;
}

export async function logAuthEvent(logService: LogService, event: AuthEventInput): Promise<void> {
  const isFailed = event.type.endsWith('_failed');

  await logService.insert({
    tenantId: event.tenantId,
    traceId: randomUUID(),
    spanId: randomUUID(),
    source: 'platform',
    category: 'auth',
    level: isFailed ? 'warn' : 'info',
    operation: `auth.${event.type}`,
    status: isFailed ? 'failed' : 'completed',
    metadata: { auth_method: event.method, ...event.metadata },
    actorType: event.actorType,
    actorId: event.actorId,
    actorName: event.actorName,
  });
}
