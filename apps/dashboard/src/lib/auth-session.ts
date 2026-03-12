import { clearSession, readSession, writeSession } from './session.js';

const TENANT_ID_PARAM = 'tenant_id';

function readTenantId(searchParams: URLSearchParams): string | null {
  const tenantId = searchParams.get(TENANT_ID_PARAM)?.trim() ?? '';
  return tenantId.length > 0 ? tenantId : null;
}

export function completeSsoBrowserSession(searchParams: URLSearchParams): boolean {
  const tenantId = readTenantId(searchParams);
  if (!tenantId) {
    clearSession();
    return false;
  }

  writeSession({
    accessToken: null,
    tenantId,
  });
  return true;
}

export function hasDashboardSession(): boolean {
  return readSession() !== null;
}
