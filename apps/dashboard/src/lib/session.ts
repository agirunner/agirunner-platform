const TENANT_KEY = 'agentbaton.tenantId';

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

  return { accessToken, tenantId };
}

export function writeSession(nextSession: SessionTokens): void {
  accessToken = nextSession.accessToken;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(TENANT_KEY, nextSession.tenantId);
  }
}

export function clearSession(): void {
  accessToken = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TENANT_KEY);
  }
}
