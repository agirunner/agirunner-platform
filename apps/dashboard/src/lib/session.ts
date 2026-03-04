const TENANT_KEY = 'agentbaton.tenantId';
const ACCESS_TOKEN_KEY = 'agentbaton.accessToken';

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
  const persistedAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!tenantId || !persistedAccessToken) {
    return null;
  }

  accessToken = persistedAccessToken;
  return { accessToken: persistedAccessToken, tenantId };
}

export function writeSession(nextSession: SessionTokens): void {
  accessToken = nextSession.accessToken;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(TENANT_KEY, nextSession.tenantId);
    if (nextSession.accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, nextSession.accessToken);
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  }
}

export function clearSession(): void {
  accessToken = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  }
}
