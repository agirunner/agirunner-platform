const AUTH_ME_PATH = '/api/v1/auth/me';
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh';
const CSRF_COOKIE_NAME = 'agirunner_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

interface AuthMePayload {
  data?: {
    tenant_id?: string;
  };
}

interface RefreshPayload {
  data?: {
    token?: string;
  };
}

interface ResolveAuthCallbackSessionOptions {
  apiBaseUrl: string;
  cookieHeader?: string;
  fetcher?: typeof fetch;
}

interface AuthCallbackSession {
  tenantId: string;
  accessToken: string | null;
}

function requestJson(
  fetcher: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetcher(url, {
    credentials: 'include',
    ...init,
  });
}

function parseTenantId(payload: AuthMePayload): string {
  const tenantId = payload.data?.tenant_id?.trim() ?? '';
  if (!tenantId) {
    throw new Error('Missing tenant context');
  }
  return tenantId;
}

function parseAccessToken(payload: RefreshPayload): string {
  const accessToken = payload.data?.token?.trim() ?? '';
  if (!accessToken) {
    throw new Error('Missing refreshed access token');
  }
  return accessToken;
}

function isUnauthorizedError(error: unknown): boolean {
  return String(error).includes('HTTP 401');
}

export function readCookieValue(cookieHeader: string, cookieName: string): string | null {
  const segments = cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (!segment.startsWith(`${cookieName}=`)) {
      continue;
    }

    const value = segment.slice(cookieName.length + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }

  return null;
}

async function fetchAuthenticatedTenantId(
  apiBaseUrl: string,
  fetcher: typeof fetch,
): Promise<string> {
  const response = await requestJson(fetcher, `${apiBaseUrl}${AUTH_ME_PATH}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseTenantId(await response.json() as AuthMePayload);
}

async function refreshAccessToken(
  apiBaseUrl: string,
  cookieHeader: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const csrfToken = readCookieValue(cookieHeader, CSRF_COOKIE_NAME);
  if (!csrfToken) {
    return null;
  }

  const response = await requestJson(fetcher, `${apiBaseUrl}${AUTH_REFRESH_PATH}`, {
    method: 'POST',
    headers: {
      [CSRF_HEADER_NAME]: csrfToken,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseAccessToken(await response.json() as RefreshPayload);
}

export async function resolveAuthCallbackSession(
  options: ResolveAuthCallbackSessionOptions,
): Promise<AuthCallbackSession> {
  const fetcher = options.fetcher ?? fetch;

  try {
    return {
      tenantId: await fetchAuthenticatedTenantId(options.apiBaseUrl, fetcher),
      accessToken: null,
    };
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshAccessToken(
    options.apiBaseUrl,
    options.cookieHeader ?? '',
    fetcher,
  );
  if (!refreshedAccessToken) {
    throw new Error('HTTP 401');
  }

  return {
    tenantId: await fetchAuthenticatedTenantId(options.apiBaseUrl, fetcher),
    accessToken: refreshedAccessToken,
  };
}
