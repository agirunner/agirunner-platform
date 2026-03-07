import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('project spec routes', () => {
  let db: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminKey: string;
  let agentKey: string;
  let projectId: string;
  let templateId: string;
  let assignedAgentId: string;
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
    process.env.PORT = '8095';
    process.env.DATABASE_URL = db.databaseUrl;
    process.env.JWT_SECRET = 'x'.repeat(64);
    process.env.WEBHOOK_ENCRYPTION_KEY = 'k'.repeat(64);
    process.env.JWT_EXPIRES_IN = '5m';
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    process.env.LOG_LEVEL = 'error';
    process.env.RATE_LIMIT_MAX_PER_MINUTE = '200';

    const project = await db.pool.query<{ id: string }>(
      `INSERT INTO projects (tenant_id, name, slug)
       VALUES ($1,'Spec Project','spec-project')
       RETURNING id`,
      [tenantId],
    );
    projectId = project.rows[0].id;

    assignedAgentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'spec-agent',ARRAY['ts'],'active',30)`,
      [assignedAgentId, tenantId],
    );

    adminKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'admin',
        ownerType: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    agentKey = (
      await createApiKey(db.pool, {
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: assignedAgentId,
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).apiKey;

    const template = await db.pool.query<{ id: string }>(
      `INSERT INTO templates (tenant_id, name, slug, version, schema)
       VALUES (
         $1,
         'Spec Template',
         'spec-template',
         1,
         $2::jsonb
       )
       RETURNING id`,
      [
        tenantId,
        JSON.stringify({
          tasks: [{ id: 't1', title_template: 'Spec Task', type: 'code' }],
        }),
      ],
    );
    templateId = template.rows[0].id;

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

  it('versions project specs and records the current spec version on workflows', async () => {
    const putSpec = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/spec`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        resources: {
          source_repo: {
            type: 'repository',
            binding: {
              url: 'git@github.com:org/repo.git',
              branch: 'main',
              provider: 'github',
            },
          },
        },
        documents: {
          api_spec: {
            source: 'repository',
            path: 'docs/api/openapi.yaml',
            repository: 'source_repo',
          },
        },
      },
    });

    expect(putSpec.statusCode).toBe(200);
    expect(putSpec.json().data.version).toBe(1);

    const getLatest = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/spec`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(getLatest.statusCode).toBe(200);
    expect(getLatest.json().data.spec.resources.source_repo.type).toBe('repository');
    expect(getLatest.json().data.spec.documents.api_spec.path).toBe('docs/api/openapi.yaml');

    const putNext = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/spec`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        resources: {
          source_repo: {
            type: 'repository',
            binding: {
              url: 'git@github.com:org/repo.git',
              branch: 'develop',
              provider: 'github',
            },
          },
        },
      },
    });

    expect(putNext.statusCode).toBe(200);
    expect(putNext.json().data.version).toBe(2);

    const getV1 = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/spec?version=1`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(getV1.statusCode).toBe(200);
    expect(getV1.json().data.spec.resources.source_repo.binding.branch).toBe('main');

    const workflowCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateId,
        project_id: projectId,
        name: 'spec-workflow',
      },
    });

    expect(workflowCreate.statusCode).toBe(201);
    expect(workflowCreate.json().data.project_spec_version).toBe(2);
  });

  it('lists project resources for admins and filters to task-relevant resources for agents', async () => {
    const taskId = randomUUID();
    await db.pool.query(
      `INSERT INTO tasks (id, tenant_id, project_id, title, type, state, assigned_agent_id, resource_bindings)
       VALUES ($1,$2,$3,'resource-task','code','claimed',$4,$5::jsonb)`,
      [
        taskId,
        tenantId,
        projectId,
        assignedAgentId,
        JSON.stringify([{ logical_name: 'source_repo' }]),
      ],
    );

    const adminList = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/resources`,
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().data).toEqual([
      expect.objectContaining({
        logical_name: 'source_repo',
        type: 'repository',
      }),
    ]);

    const agentList = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/resources?task_id=${taskId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(agentList.statusCode).toBe(200);
    expect(agentList.json().data).toEqual([
      expect.objectContaining({
        logical_name: 'source_repo',
      }),
    ]);
  });

  it('rejects credential-like fields in resource bindings', async () => {
    const putSpec = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/spec`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        resources: {
          insecure_api: {
            type: 'api',
            binding: {
              base_url: 'https://api.example.com',
              api_key: 'should-not-store',
            },
          },
        },
      },
    });

    expect(putSpec.statusCode).toBe(400);
    expect(putSpec.json().error.message).toMatch(/credential-like field/i);
  });

  it('rejects invalid document references in the project spec', async () => {
    const putSpec = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/spec`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        documents: {
          broken_doc: {
            source: 'artifact',
          },
        },
      },
    });

    expect(putSpec.statusCode).toBe(400);
    expect(putSpec.json().error.message).toMatch(/artifact_id or logical_path/i);
  });

  it('lists project-spec document references through the workflow documents endpoint', async () => {
    const putSpec = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/spec`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        resources: {
          source_repo: {
            type: 'repository',
            binding: {
              url: 'git@github.com:org/repo.git',
              branch: 'main',
              provider: 'github',
            },
          },
        },
        documents: {
          architecture: {
            source: 'repository',
            repository: 'source_repo',
            path: 'docs/architecture.md',
            title: 'Architecture Overview',
          },
          runbook: {
            source: 'external',
            url: 'https://example.com/runbook',
          },
        },
      },
    });

    expect(putSpec.statusCode).toBe(200);

    const workflowCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateId,
        project_id: projectId,
        name: 'document-workflow',
      },
    });

    expect(workflowCreate.statusCode).toBe(201);
    const workflowId = workflowCreate.json().data.id as string;

    const documents = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${workflowId}/documents`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(documents.statusCode).toBe(200);
    expect(documents.json().data).toEqual([
      expect.objectContaining({
        logical_name: 'architecture',
        scope: 'project',
        source: 'repository',
        path: 'docs/architecture.md',
        repository: 'source_repo',
      }),
      expect.objectContaining({
        logical_name: 'runbook',
        scope: 'project',
        source: 'external',
        url: 'https://example.com/runbook',
      }),
    ]);
  });
});
