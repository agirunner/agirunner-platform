import { clearSession, readSession, writeSession } from './session.js';

const TENANT_ID_PARAM = 'tenant_id';
const REDIRECT_PARAM = 'redirect_to';
const DEFAULT_REDIRECT_PATH = '/';

function readTenantId(searchParams: URLSearchParams): string | null {
  const tenantId = searchParams.get(TENANT_ID_PARAM)?.trim() ?? '';
  return tenantId.length > 0 ? tenantId : null;
}

export function resolveAuthCallbackRedirect(searchParams: URLSearchParams): string {
  const redirectPath = searchParams.get(REDIRECT_PARAM)?.trim() ?? '';
  if (!redirectPath.startsWith('/') || redirectPath.startsWith('//')) {
    return DEFAULT_REDIRECT_PATH;
  }

  return redirectPath;
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
