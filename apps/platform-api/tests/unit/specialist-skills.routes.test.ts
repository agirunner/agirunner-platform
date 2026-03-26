import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      userId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

describe('specialist skill routes', () => {
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

  it('lists specialist skills', async () => {
    const { specialistSkillRoutes } = await import(
      '../../src/api/routes/specialist-skills.routes.js'
    );
    const listSkills = vi.fn(async () => [
      {
        id: 'skill-1',
        name: 'Structured Search',
        slug: 'structured-search',
        summary: 'Search deliberately.',
        content: 'Always begin with a plan.',
        is_archived: false,
      },
    ]);

    app = fastify();
    registerErrorHandler(app);
    app.decorate('specialistSkillService', {
      listSkills,
      getSkillById: vi.fn(),
      createSkill: vi.fn(),
      updateSkill: vi.fn(),
      setArchived: vi.fn(),
    });

    await app.register(specialistSkillRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/specialist-skills',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listSkills).toHaveBeenCalledWith('tenant-1');
  });

  it('creates and archives specialist skills', async () => {
    const { specialistSkillRoutes } = await import(
      '../../src/api/routes/specialist-skills.routes.js'
    );
    const createSkill = vi.fn(async () => ({
      id: 'skill-1',
      name: 'Structured Search',
      slug: 'structured-search',
      summary: 'Search deliberately.',
      content: 'Always begin with a plan.',
      is_archived: false,
    }));
    const setArchived = vi.fn(async () => ({
      id: 'skill-1',
      name: 'Structured Search',
      slug: 'structured-search',
      summary: 'Search deliberately.',
      content: 'Always begin with a plan.',
      is_archived: true,
    }));

    app = fastify();
    registerErrorHandler(app);
    app.decorate('specialistSkillService', {
      listSkills: vi.fn(),
      getSkillById: vi.fn(),
      createSkill,
      updateSkill: vi.fn(),
      setArchived,
    });

    await app.register(specialistSkillRoutes);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/specialist-skills',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'Structured Search',
        summary: 'Search deliberately.',
        content: 'Always begin with a plan.',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createSkill).toHaveBeenCalledWith('tenant-1', {
      name: 'Structured Search',
      summary: 'Search deliberately.',
      content: 'Always begin with a plan.',
    });

    const archiveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/specialist-skills/skill-1/archive',
      headers: { authorization: 'Bearer test' },
    });
    expect(archiveResponse.statusCode).toBe(200);
    expect(setArchived).toHaveBeenCalledWith('tenant-1', 'skill-1', true);
  });
});
