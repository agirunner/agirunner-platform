const TENANT_KEY = 'agirunner.tenantId';
const ACCESS_TOKEN_KEY = 'agirunner.accessToken';

export interface SessionTokens {
  accessToken: string | null;
  tenantId: string;
  persistentSession?: boolean;
}

interface SessionBootstrap {
  tenantId: string;
  persistentSession: boolean;
}

function readTenantFromStorage(storage: Storage | undefined, persistentSession: boolean): SessionBootstrap | null {
  if (!storage) {
    return null;
  }

  const tenantId = storage.getItem(TENANT_KEY);
  if (!tenantId || tenantId.trim().length === 0) {
    return null;
  }

  return {
    tenantId,
    persistentSession,
  };
}

function readBootstrap(): SessionBootstrap | null {
  if (typeof sessionStorage !== 'undefined') {
    const sessionBootstrap = readTenantFromStorage(sessionStorage, false);
    if (sessionBootstrap) {
      return sessionBootstrap;
    }
  }

  if (typeof localStorage !== 'undefined') {
    return readTenantFromStorage(localStorage, true);
  }

  return null;
}

export function readSession(): SessionTokens | null {
  const bootstrap = readBootstrap();
  if (!bootstrap) {
    return null;
  }

  const persistedAccessToken =
    typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(ACCESS_TOKEN_KEY);

  return {
    accessToken: persistedAccessToken,
    tenantId: bootstrap.tenantId,
    persistentSession: bootstrap.persistentSession,
  };
}

export function writeSession(nextSession: SessionTokens): void {
  const bootstrapStorage =
    nextSession.persistentSession && typeof localStorage !== 'undefined'
      ? localStorage
      : typeof sessionStorage !== 'undefined'
        ? sessionStorage
        : undefined;
  const alternateBootstrapStorage =
    bootstrapStorage === localStorage ? sessionStorage : localStorage;

  bootstrapStorage?.setItem(TENANT_KEY, nextSession.tenantId);
  alternateBootstrapStorage?.removeItem(TENANT_KEY);

  if (typeof sessionStorage !== 'undefined') {
    if (nextSession.accessToken) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, nextSession.accessToken);
    } else {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  }
}

export function clearSession(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(TENANT_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(TENANT_KEY);
  }
}
