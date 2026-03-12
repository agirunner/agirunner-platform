const TENANT_KEY = 'agirunner.tenantId';
const ACCESS_TOKEN_KEY = 'agirunner.accessToken';

let accessToken: string | null = null;

export interface SessionTokens {
  accessToken: string | null;
  tenantId: string;
}

function readLegacyTenantId(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const tenantId = localStorage.getItem(TENANT_KEY);
  if (!tenantId) {
    return null;
  }

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(TENANT_KEY, tenantId);
  }
  localStorage.removeItem(TENANT_KEY);
  return tenantId;
}

function readTenantId(): string | null {
  if (typeof sessionStorage !== 'undefined') {
    const tenantId = sessionStorage.getItem(TENANT_KEY);
    if (tenantId) {
      return tenantId;
    }
  }

  return readLegacyTenantId();
}

export function readSession(): SessionTokens | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  const tenantId = readTenantId();
  if (!tenantId) {
    return null;
  }

  const persistedAccessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  accessToken = persistedAccessToken;

  return { accessToken: persistedAccessToken, tenantId };
}

export function writeSession(nextSession: SessionTokens): void {
  accessToken = nextSession.accessToken;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(TENANT_KEY, nextSession.tenantId);
    if (nextSession.accessToken) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, nextSession.accessToken);
    } else {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TENANT_KEY);
  }
}

export function clearSession(): void {
  accessToken = null;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(TENANT_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TENANT_KEY);
  }
}
