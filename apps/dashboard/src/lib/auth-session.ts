import { clearSession, readSession, writeSession } from './session.js';

const TENANT_ID_PARAM = 'tenant_id';
const REDIRECT_PARAM = 'redirect_to';
const DEFAULT_REDIRECT_PATH = '/';

interface CompleteSsoBrowserSessionOptions {
  accessToken?: string | null;
  persistentSession?: boolean;
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

function resolvePersistentSession(
  tenantId: string,
  options: CompleteSsoBrowserSessionOptions,
): boolean {
  if ('persistentSession' in options && typeof options.persistentSession === 'boolean') {
    return options.persistentSession;
  }

  const session = readSession();
  if (!session || session.tenantId !== tenantId) {
    return false;
  }

  return session.persistentSession ?? false;
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
    persistentSession: resolvePersistentSession(tenantId, options),
  });
  return true;
}

export function hasDashboardSession(): boolean {
  return readSession() !== null;
}
