import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async () => {},
}));

vi.mock('../../../../../src/auth/jwt.js', () => ({
  issueUserAccessToken: vi.fn().mockResolvedValue('user-access-token'),
}));

vi.mock('../../../../../src/auth/sso-provider.js', () => ({
  getSSOProviderConfig: vi.fn().mockReturnValue({ clientId: 'client-1' }),
  exchangeCodeForUser: vi.fn().mockResolvedValue({
    provider: 'google',
    providerUserId: 'google-user-1',
    email: 'operator@example.com',
    displayName: 'Operator',
  }),
}));

describe('users routes sso callback', () => {
  let app: ReturnType<typeof fastify> | undefined;
  const dashboardUrl = 'http://dashboard.example.test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('redirects without tokens or tenant context in the URL and sets an httpOnly access cookie', async () => {
    const { userRoutes } = await import('../../../../../src/api/routes/auth/users.routes.js');

    app = fastify();
    await app.register(fastifyCookie);
    app.decorate('config', { AGIRUNNER_DASHBOARD_URL: dashboardUrl, DASHBOARD_URL: dashboardUrl } as never);
    app.decorate('userService', {
      createUser: vi.fn(),
      listUsers: vi.fn(),
      getUserById: vi.fn(),
      updateUser: vi.fn(),
      deactivateUser: vi.fn(),
      findOrCreateFromSSO: vi.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-42',
        role: 'org_admin',
        email: 'operator@example.com',
      }),
    });

    await app.register(userRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sso/google/callback?code=test-code&state=test-state',
      cookies: {
        sso_state_google: 'test-state',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${dashboardUrl}/auth/callback`);
    expect(response.headers.location).not.toContain('access_token');
    expect(response.headers.location).not.toContain('refresh_token');
    expect(response.headers.location).not.toContain('tenant_id');

    const setCookie = response.cookies.find(
      (cookie: { name: string }) => cookie.name === 'agirunner_access_token',
    );
    expect(setCookie).toMatchObject({
      name: 'agirunner_access_token',
      value: 'user-access-token',
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
    });
  });
});
