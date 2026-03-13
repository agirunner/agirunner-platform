import { clearSession, readSession, writeSession } from './session.js';

const TENANT_ID_PARAM = 'tenant_id';
const REDIRECT_PARAM = 'redirect_to';
const DEFAULT_REDIRECT_PATH = '/';

interface CompleteSsoBrowserSessionOptions {
  accessToken?: string | null;
}

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

function resolveAccessToken(
  tenantId: string,
  options: CompleteSsoBrowserSessionOptions,
): string | null {
  if (options.accessToken !== undefined) {
    return options.accessToken;
  }

  const session = readSession();
  if (!session || session.tenantId !== tenantId) {
    return null;
  }

  return session.accessToken;
}

export function completeSsoBrowserSession(
  searchParams: URLSearchParams,
  options: CompleteSsoBrowserSessionOptions = {},
): boolean {
  const tenantId = readTenantId(searchParams);
  if (!tenantId) {
    clearSession();
    return false;
  }

  writeSession({
    accessToken: resolveAccessToken(tenantId, options),
    tenantId,
  });
  return true;
}

export function hasDashboardSession(): boolean {
  return readSession() !== null;
}
