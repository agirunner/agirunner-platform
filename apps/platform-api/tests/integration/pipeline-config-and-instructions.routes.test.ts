import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('pipeline config and instruction routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let agentKey: string;
  let agentId: string;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    db = await startTestDatabase();

    for (const key of [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'JWT_SECRET',
      'WEBHOOK_ENCRYPTION_KEY',
      'JWT_EXPIRES_IN',
      'JWT_REFRESH_EXPIRES_IN',
      'LOG_LEVEL',
      'RATE_LIMIT_MAX_PER_MINUTE',
    ]) {
      previousEnv[key] = process.env[key];
    }

    process.env.NODE_ENV = 'test';
    process.env.PORT = '8092';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    adminKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, metadata, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'cfg-agent',ARRAY['ts'],$3::jsonb,'idle',30)`,
      [agentId, tenantId, JSON.stringify({ profile: { instructions: 'Fallback profile guidance' } })],
    );

    agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await stopTestDatabase(db);
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('resolves pipeline config, validates overrides, and assembles instruction layers on task claim', async () => {
    const template = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'cfg-template',
        slug: `cfg-template-${Date.now()}`,
        schema: {
          config: {
            runtime: {
              timeout: 30,
              mode: 'safe',
            },
            tools: ['git'],
          },
          config_policy: {
            locked: ['runtime.mode'],
            constraints: {
              'runtime.timeout': {
                min: 10,
                max: 60,
              },
            },
          },
          default_instruction_config: {
            suppress_layers: ['platform'],
          },
          tasks: [
            {
              id: 'review',
              title_template: 'Review',
              type: 'review',
              role: 'reviewer',
              role_config: {
                system_prompt: 'Review carefully',
              },
              input_template: {
                instructions: 'Use the ticket context',
              },
            },
          ],
        },
      },
    });
    expect(template.statusCode).toBe(201);
    const templateId = template.json().data.id as string;

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'Config Project',
        slug: `cfg-project-${Date.now()}`,
      },
    });
    const projectId = project.json().data.id as string;

    const spec = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/spec`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        config: {
          runtime: {
            timeout: 45,
          },
        },
        instructions: {
          content: 'Use TypeScript strict mode',
          format: 'markdown',
        },
      },
    });
    expect(spec.statusCode).toBe(200);

    const platformInstructions = await app.inject({
      method: 'PUT',
      url: '/api/v1/platform/instructions',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        content: 'Always cite sources',
        format: 'text',
      },
    });
    expect(platformInstructions.statusCode).toBe(200);

    const versions = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/instructions/versions',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().data).toHaveLength(1);

    const lockedOverride = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateId,
        project_id: projectId,
        name: 'locked-override',
        config_overrides: {
          runtime: {
            mode: 'fast',
          },
        },
      },
    });
    expect(lockedOverride.statusCode).toBe(400);

    const constrainedOverride = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateId,
        project_id: projectId,
        name: 'bad-timeout',
        config_overrides: {
          runtime: {
            timeout: 5,
          },
        },
      },
    });
    expect(constrainedOverride.statusCode).toBe(400);

    const pipeline = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateId,
        project_id: projectId,
        name: 'good-pipeline',
        config_overrides: {
          runtime: {
            timeout: 50,
          },
          tools: ['git', 'shell'],
        },
        instruction_config: {
          suppress_layers: [],
        },
      },
    });
    expect(pipeline.statusCode).toBe(201);
    const pipelineId = pipeline.json().data.id as string;
    const taskId = pipeline.json().data.tasks[0].id as string;

    const resolvedConfig = await app.inject({
      method: 'GET',
      url: `/api/v1/pipelines/${pipelineId}/config/resolved?show_layers=true`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(resolvedConfig.statusCode).toBe(200);
    expect(resolvedConfig.json().data.resolved_config.runtime.timeout).toEqual({
      value: 50,
      source: 'run',
    });
    expect(resolvedConfig.json().data.resolved_config.runtime.mode).toEqual({
      value: 'safe',
      source: 'template',
    });
    expect(resolvedConfig.json().data.config_layers.project).toEqual({
      runtime: { timeout: 45 },
    });

    const claimed = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['ts'],
      },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().data.instructions).toBe('Review carefully');
    expect(claimed.json().data.context.pipeline.resolved_config).toEqual({
      runtime: { timeout: 50, mode: 'safe' },
      tools: ['git', 'shell'],
    });
    expect(claimed.json().data.context.instruction_layers.platform.content).toBe(
      'Always cite sources',
    );
    expect(claimed.json().data.context.instruction_layers.project.content).toBe(
      'Use TypeScript strict mode',
    );
    expect(claimed.json().data.context.instruction_layers.role.content).toBe(
      'Review carefully',
    );
    expect(claimed.json().data.context.instruction_layers.task.content).toBe(
      'Use the ticket context',
    );

    const current = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/instructions',
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().data.content).toBe('Always cite sources');
  });

  it('preserves flat instructions when instruction layers are suppressed or omitted from context', async () => {
    const template = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'suppressed-template',
        slug: `suppressed-template-${Date.now()}`,
        schema: {
          default_instruction_config: {
            suppress_layers: ['platform'],
          },
          tasks: [
            {
              id: 'build',
              title_template: 'Build',
              type: 'code',
              role_config: {
                system_prompt: 'Build carefully',
              },
            },
          ],
        },
      },
    });
    const pipeline = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: template.json().data.id,
        name: 'suppressed-pipeline',
      },
    });
    const taskId = pipeline.json().data.tasks[0].id as string;

    const context = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}/context?agent_id=${agentId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().data.instructions).toBe('Build carefully');
    expect(context.json().data.instruction_layers.platform).toBeUndefined();

    await db.pool.query(`UPDATE agents SET current_task_id = NULL, status = 'idle' WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      agentId,
    ]);
    await db.pool.query(`UPDATE tasks SET state = 'ready', assigned_agent_id = NULL, claimed_at = NULL WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      taskId,
    ]);

    const claimed = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['ts'],
        pipeline_id: pipeline.json().data.id,
        include_context: false,
      },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().data.instructions).toBe('Build carefully');
    expect(claimed.json().data.context).toBeUndefined();
  });
});
