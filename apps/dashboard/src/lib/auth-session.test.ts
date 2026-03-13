import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  completeSsoBrowserSession,
  hasDashboardSession,
  resolveAuthCallbackRedirect,
} from './auth-session.js';
import { clearSession, readSession } from './session.js';

function createStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('auth session helpers', () => {
  beforeEach(() => {
    const localStore = new Map<string, string>();
    const sessionStore = new Map<string, string>();
    vi.stubGlobal('localStorage', createStorage(localStore));
    vi.stubGlobal('sessionStorage', createStorage(sessionStore));
    clearSession();
  });

  it('creates a cookie-backed browser session from a non-secret tenant callback param', () => {
    const searchParams = new URLSearchParams({ tenant_id: 'tenant-42' });

    expect(completeSsoBrowserSession(searchParams)).toBe(true);
    expect(readSession()).toEqual({ accessToken: null, tenantId: 'tenant-42' });
    expect(sessionStorage.getItem('agirunner.tenantId')).toBe('tenant-42');
    expect(localStorage.getItem('agirunner.tenantId')).toBeNull();
    expect(sessionStorage.getItem('agirunner.accessToken')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(hasDashboardSession()).toBe(true);
  });

  it('clears the browser session when the callback is missing tenant context', () => {
    const searchParams = new URLSearchParams();

    expect(completeSsoBrowserSession(searchParams)).toBe(false);
    expect(readSession()).toBeNull();
    expect(hasDashboardSession()).toBe(false);
  });

  it('preserves the provider callback destination for cookie-backed auth recovery', () => {
    const searchParams = new URLSearchParams({
      redirect_to: '/config/llm?oauth_success=true&provider_id=provider-1',
      tenant_id: 'tenant-42',
    });

    expect(completeSsoBrowserSession(searchParams)).toBe(true);
    expect(resolveAuthCallbackRedirect(searchParams)).toBe(
      '/config/llm?oauth_success=true&provider_id=provider-1',
    );
    expect(readSession()).toEqual({ accessToken: null, tenantId: 'tenant-42' });
  });

  it('falls back to the root route for unsafe callback redirects', () => {
    expect(
      resolveAuthCallbackRedirect(
        new URLSearchParams({ redirect_to: 'https://dashboard.example.com/config/llm' }),
      ),
    ).toBe('/');
    expect(
      resolveAuthCallbackRedirect(
        new URLSearchParams({ redirect_to: '//dashboard.example.com/config/llm' }),
      ),
    ).toBe('/');
  });
});
