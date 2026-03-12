const TENANT_KEY = 'agirunner.tenantId';
const ACCESS_TOKEN_KEY = 'agirunner.accessToken';

let accessToken: string | null = null;

export interface SessionTokens {
  accessToken: string | null;
  tenantId: string;
}

export function readSession(): SessionTokens | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const tenantId = localStorage.getItem(TENANT_KEY);
  if (!tenantId) {
    return null;
  }

  const persistedAccessToken =
    typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(ACCESS_TOKEN_KEY);
  accessToken = persistedAccessToken;

  return { accessToken: persistedAccessToken, tenantId };
}

export function writeSession(nextSession: SessionTokens): void {
  accessToken = nextSession.accessToken;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(TENANT_KEY, nextSession.tenantId);
  }
  if (typeof sessionStorage !== 'undefined') {
    if (nextSession.accessToken) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, nextSession.accessToken);
    } else {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  }
}

export function clearSession(): void {
  accessToken = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TENANT_KEY);
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  }
}
