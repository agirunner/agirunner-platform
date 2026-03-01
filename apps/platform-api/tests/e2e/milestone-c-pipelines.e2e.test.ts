import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('milestone c pipeline/template e2e', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let agentKey: string;
  let agentId: string;

  beforeAll(async () => {
    db = await startTestDatabase();

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8090';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'y'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.LOG_LEVEL = 'error';

    adminKey = (
      await createApiKey(db.pool, {
        tenantId: '00000000-0000-0000-0000-000000000001',
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).apiKey;

    app = await buildApp();

    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/register',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: 'pipeline-agent', capabilities: ['typescript'] },
    });

    agentId = register.json().data.id as string;
    agentKey = register.json().data.api_key as string;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await stopTestDatabase(db);
  });

  it('runs template CRUD and full pipeline lifecycle', async () => {
    const createTemplate = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'E2E Template',
        slug: `e2e-template-${Date.now()}`,
        schema: {
          variables: [{ name: 'feature', type: 'string' }],
          metadata: { domain: 'auth' },
          tasks: [
            { id: 'analysis', title_template: 'Analyze ${feature}', type: 'analysis' },
            { id: 'code', title_template: 'Code ${feature}', type: 'code', depends_on: ['analysis'] },
          ],
        },
      },
    });
    expect(createTemplate.statusCode).toBe(201);
    const templateId = createTemplate.json().data.id as string;

    const listTemplates = await app.inject({
      method: 'GET',
      url: '/api/v1/templates?page=1&per_page=10',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(listTemplates.statusCode).toBe(200);

    const getTemplate = await app.inject({
      method: 'GET',
      url: `/api/v1/templates/${templateId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(getTemplate.statusCode).toBe(200);

    const patchTemplate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/templates/${templateId}`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        description: 'updated',
        schema: {
          variables: [{ name: 'feature', type: 'string' }],
          metadata: { domain: 'auth' },
          tasks: [
            { id: 'analysis', title_template: 'Analyze v2 ${feature}', type: 'analysis' },
            { id: 'code', title_template: 'Code v2 ${feature}', type: 'code', depends_on: ['analysis'] },
          ],
        },
      },
    });
    expect(patchTemplate.statusCode).toBe(200);
    const templateV2Id = patchTemplate.json().data.id as string;
    expect(templateV2Id).not.toBe(templateId);
    expect(patchTemplate.json().data.version).toBe(2);

    const templateV1 = await app.inject({
      method: 'GET',
      url: `/api/v1/templates/${templateId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(templateV1.statusCode).toBe(200);
    expect(templateV1.json().data.version).toBe(1);
    expect(templateV1.json().data.description).toBeNull();

    const createPipeline = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateId,
        name: 'E2E Pipeline',
        parameters: { feature: 'login' },
      },
    });
    expect(createPipeline.statusCode).toBe(201);
    expect(createPipeline.json().data.template_id).toBe(templateV2Id);
    expect(createPipeline.json().data.template_version).toBe(2);
    expect((createPipeline.json().data.tasks as Array<{ title: string }>)[0].title).toBe('Analyze v2 login');
    const pipelineId = createPipeline.json().data.id as string;

    const claimOne = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId, capabilities: ['typescript'] },
    });
    expect(claimOne.statusCode).toBe(200);
    const taskOne = claimOne.json().data.id as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskOne}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskOne}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { output: { summary: 'analysis complete' } },
    });

    const claimTwo = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId, capabilities: ['typescript'] },
    });
    expect(claimTwo.statusCode).toBe(200);
    const taskTwo = claimTwo.json().data.id as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskTwo}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskTwo}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { output: { summary: 'code complete' } },
    });

    const context = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskTwo}/context`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().data.pipeline.variables.feature).toBe('login');

    const getPipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/pipelines/${pipelineId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(getPipeline.statusCode).toBe(200);
    expect(getPipeline.json().data.state).toBe('completed');

    const deleteTemplate = await app.inject({
      method: 'DELETE',
      url: `/api/v1/templates/${templateId}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(deleteTemplate.statusCode).toBe(200);
  });

  it('covers milestone-c endpoint error matrix classes', async () => {
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: 'Bearer bad-key' },
      payload: {},
    });
    expect(unauthorized.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { name: 'x', slug: 'x', schema: { tasks: [{ id: 'a', title_template: 'a', type: 'code' }] } },
    });
    expect(forbidden.statusCode).toBe(403);

    const notFound = await app.inject({
      method: 'GET',
      url: `/api/v1/templates/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(notFound.statusCode).toBe(404);

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'cycle',
        slug: `cycle-${Date.now()}`,
        schema: {
          tasks: [
            { id: 'a', title_template: 'a', type: 'code', depends_on: ['b'] },
            { id: 'b', title_template: 'b', type: 'code', depends_on: ['a'] },
          ],
        },
      },
    });
    expect(conflict.statusCode).toBe(409);

    const unprocessable = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { template_id: 'bad-uuid', name: 'bad' },
    });
    expect(unprocessable.statusCode).toBe(422);
  });
});
