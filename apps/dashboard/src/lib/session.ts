const TENANT_KEY = 'agentbaton.tenantId';

let accessToken: string | null = null;

export interface SessionTokens {
  accessToken: string | null;
  tenantId: string;
}

export function readSession(): SessionTokens | null {
  const tenantId = localStorage.getItem(TENANT_KEY);
  if (!tenantId) {
    return null;
  }

  return { accessToken, tenantId };
}

export function writeSession(nextSession: SessionTokens): void {
  accessToken = nextSession.accessToken;
  localStorage.setItem(TENANT_KEY, nextSession.tenantId);
}

export function clearSession(): void {
  accessToken = null;
  localStorage.removeItem(TENANT_KEY);
}
