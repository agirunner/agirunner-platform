import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: () => async () => {},
}));

describe('agents routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('rejects legacy capabilities on agent registration', async () => {
    const { agentRoutes } = await import('../../src/api/routes/agents.routes.js');
    const registerAgent = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('agentService', {
      registerAgent,
      heartbeat: vi.fn(),
      listAgents: vi.fn(),
    });

    await app.register(agentRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/register',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'agent-1',
        capabilities: ['coding'],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(registerAgent).not.toHaveBeenCalled();
  });
});
