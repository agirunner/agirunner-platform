import type { DashboardApiKeyRecord } from '../../lib/api.js';

import { isWithinDays } from './governance-lifecycle.support.js';

export type ApiKeyScopeVariant = 'default' | 'success' | 'destructive' | 'warning' | 'secondary';

const SCOPE_VARIANT: Record<string, ApiKeyScopeVariant> = {
  admin: 'destructive',
  worker: 'warning',
  agent: 'success',
};

const SCOPE_DESCRIPTION: Record<string, string> = {
  admin: 'Full platform administration. Use only for short-lived operator tasks.',
  worker: 'Automation and runtime control without tenant-wide admin access.',
  agent: 'Narrow orchestration use with the smallest default blast radius.',
};

export function scopeVariant(scope: string): ApiKeyScopeVariant {
  return SCOPE_VARIANT[scope.toLowerCase()] ?? 'secondary';
}

export function scopeDescription(scope: string): string {
  return SCOPE_DESCRIPTION[scope.toLowerCase()] ?? 'Use the narrowest scope that still completes the task.';
}

export function describeOwner(key: DashboardApiKeyRecord): string {
  return key.owner_id ?? key.owner_type;
}

export function summarizeApiKeys(apiKeys: DashboardApiKeyRecord[]) {
  return {
    active: apiKeys.filter((key) => !key.is_revoked).length,
    admin: apiKeys.filter((key) => !key.is_revoked && key.scope === 'admin').length,
    expiringSoon: apiKeys.filter((key) => !key.is_revoked && isWithinDays(key.expires_at, 7)).length,
    neverUsed: apiKeys.filter((key) => !key.last_used_at).length,
  };
}
