import type { DashboardApiKeyRecord } from '../../lib/api.js';

import { isWithinDays } from './api-key-lifecycle.support.js';

const OPERATOR_SCOPES = new Set(['admin', 'service']);

const SCOPE_DESCRIPTION: Record<string, string> = {
  admin: 'Operator access for full dashboard and API control.',
  service: 'External service and integration access. Currently full control.',
};

const SCOPE_LABEL: Record<string, string> = {
  admin: 'Admin',
  service: 'Service',
  worker: 'Specialist Agent',
  agent: 'Specialist Execution',
};

const SCOPE_NAME: Record<string, string> = {
  admin: 'Admin',
  service: 'Service',
  worker: 'Specialist Agent',
  agent: 'Specialist Execution',
};

export function isOperatorKey(record: DashboardApiKeyRecord): boolean {
  return OPERATOR_SCOPES.has(record.scope.toLowerCase());
}

export function splitApiKeys(apiKeys: DashboardApiKeyRecord[]) {
  return {
    operatorKeys: apiKeys.filter(isOperatorKey),
    systemKeys: apiKeys.filter((record) => !isOperatorKey(record)),
  };
}

export function scopeDescription(scope: string): string {
  return SCOPE_DESCRIPTION[scope.toLowerCase()] ?? 'Platform-managed credentials.';
}

export function scopeLabel(scope: string): string {
  return SCOPE_LABEL[scope.toLowerCase()] ?? scope;
}

export function scopeName(scope: string): string {
  return SCOPE_NAME[scope.toLowerCase()] ?? scope;
}

export function summarizeApiKeys(apiKeys: DashboardApiKeyRecord[]) {
  const operatorKeys = apiKeys.filter(isOperatorKey);

  return {
    active: apiKeys.filter((key) => !key.is_revoked).length,
    operator: operatorKeys.filter((key) => !key.is_revoked).length,
    expiringSoon: operatorKeys.filter((key) => !key.is_revoked && isWithinDays(key.expires_at, 7)).length,
    neverUsed: apiKeys.filter((key) => !key.last_used_at).length,
  };
}
