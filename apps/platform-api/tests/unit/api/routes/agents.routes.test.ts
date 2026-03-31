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

  it('accepts explicit suppression of agent api key issuance', async () => {
    const { agentRoutes } = await import('../../src/api/routes/agents.routes.js');
    const registerAgent = vi.fn().mockResolvedValue({ id: 'agent-1' });

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
        execution_mode: 'orchestrator',
        worker_id: '8f4408f0-d6f6-4ee6-b1d0-a33248b22d0f',
        issue_api_key: false,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(registerAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ issue_api_key: false }),
    );
  });

  it('accepts playbook scope on agent registration', async () => {
    const { agentRoutes } = await import('../../src/api/routes/agents.routes.js');
    const registerAgent = vi.fn().mockResolvedValue({ id: 'agent-1' });

    app = fastify();
    registerErrorHandler(app);
    app.decorate('agentService', {
      registerAgent,
      heartbeat: vi.fn(),
      listAgents: vi.fn(),
    });

    await app.register(agentRoutes);

    const playbookId = '9a3e8d3b-11e5-44fd-9d7a-5da6bf0f1c1d';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/register',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'agent-1',
        execution_mode: 'orchestrator',
        playbook_id: playbookId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(registerAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ playbook_id: playbookId }),
    );
  });
});
