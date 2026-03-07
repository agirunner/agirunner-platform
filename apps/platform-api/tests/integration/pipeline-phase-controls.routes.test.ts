import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('pipeline phase control routes', () => {
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
    process.env.PORT = '8094';
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
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds)
       VALUES ($1,$2,'phase-agent',ARRAY['workflow'],'idle',30)`,
      [agentId, tenantId],
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

  it('approves a manual phase gate and activates the next phase', async () => {
    const templateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'phase-gate-template',
        slug: `phase-gate-template-${Date.now()}`,
        schema: {
          tasks: [
            { id: 'spec', title_template: 'Spec', type: 'docs', capabilities_required: ['workflow'] },
            { id: 'release', title_template: 'Release', type: 'orchestration', capabilities_required: ['workflow'] },
          ],
          workflow: {
            phases: [
              { name: 'plan', gate: 'manual', tasks: ['spec'] },
              { name: 'ship', tasks: ['release'] },
            ],
          },
        },
      },
    });
    expect(templateResponse.statusCode).toBe(201);

    const pipelineResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateResponse.json().data.id,
        name: 'phase gate pipeline',
      },
    });
    expect(pipelineResponse.statusCode).toBe(201);
    const pipelineId = pipelineResponse.json().data.id as string;
    const taskId = pipelineResponse.json().data.tasks[0].id as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['workflow'],
        pipeline_id: pipelineId,
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { output: { ok: true }, agent_id: agentId },
    });

    const gateResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/pipelines/${pipelineId}/phases/plan/gate`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { action: 'approve' },
    });
    expect(gateResponse.statusCode).toBe(200);
    expect(gateResponse.json().data.current_phase).toBe('ship');

    const pipelineReload = await app.inject({
      method: 'GET',
      url: `/api/v1/pipelines/${pipelineId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(pipelineReload.statusCode).toBe(200);
    const phases = pipelineReload.json().data.phases as Array<Record<string, unknown>>;
    expect(phases.find((phase) => phase.name === 'plan')?.gate_status).toBe('approved');
    expect(phases.find((phase) => phase.name === 'ship')?.status).toBe('active');
    const tasks = pipelineReload.json().data.tasks as Array<Record<string, unknown>>;
    expect(tasks.find((task) => task.role === 'release')?.state).toBe('ready');
  });

  it('cancels the selected phase and downstream phases', async () => {
    const templateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'phase-cancel-template',
        slug: `phase-cancel-template-${Date.now()}`,
        schema: {
          tasks: [
            { id: 'plan_a', title_template: 'Plan A', type: 'docs' },
            { id: 'build_a', title_template: 'Build A', type: 'code' },
            { id: 'build_b', title_template: 'Build B', type: 'code' },
            { id: 'release', title_template: 'Release', type: 'orchestration' },
          ],
          workflow: {
            phases: [
              { name: 'plan', tasks: ['plan_a'] },
              { name: 'build', tasks: ['build_a', 'build_b'] },
              { name: 'ship', tasks: ['release'] },
            ],
          },
        },
      },
    });
    expect(templateResponse.statusCode).toBe(201);

    const pipelineResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateResponse.json().data.id,
        name: 'phase cancel pipeline',
      },
    });
    expect(pipelineResponse.statusCode).toBe(201);
    const pipelineId = pipelineResponse.json().data.id as string;

    await db.pool.query(
      `UPDATE tasks
          SET state = CASE
            WHEN metadata->>'workflow_phase' = 'plan' THEN 'completed'::task_state
            WHEN metadata->>'workflow_phase' = 'build' THEN 'ready'::task_state
            ELSE 'pending'::task_state
          END
        WHERE tenant_id = $1
          AND pipeline_id = $2`,
      [tenantId, pipelineId],
    );

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/pipelines/${pipelineId}/phases/build/cancel`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(cancelResponse.statusCode).toBe(200);

    const pipelineReload = await app.inject({
      method: 'GET',
      url: `/api/v1/pipelines/${pipelineId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    const phases = pipelineReload.json().data.phases as Array<Record<string, unknown>>;
    expect(phases.find((phase) => phase.name === 'build')?.status).toBe('cancelled');
    expect(phases.find((phase) => phase.name === 'ship')?.status).toBe('cancelled');
    const tasks = pipelineReload.json().data.tasks as Array<Record<string, unknown>>;
    expect(
      tasks
        .filter((task) =>
          ['build', 'ship'].includes(
            String((task.metadata as Record<string, unknown> | undefined)?.workflow_phase),
          ),
        )
        .every((task) => task.state === 'cancelled'),
    ).toBe(true);
  });

  it('creates a planning pipeline and resumes the same planning task with clarification answers', async () => {
    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'Planning Project',
        slug: `planning-project-${Date.now()}`,
      },
    });
    expect(projectResponse.statusCode).toBe(201);
    const projectId = projectResponse.json().data.id as string;

    const pipelineResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/planning-pipeline`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        brief: 'Build a customer support assistant with escalation workflows.',
      },
    });
    expect(pipelineResponse.statusCode).toBe(201);
    expect(pipelineResponse.json().data.metadata.planning_pipeline).toBe(true);

    const pipelineId = pipelineResponse.json().data.id as string;
    const planningTask = pipelineResponse.json().data.tasks[0] as Record<string, unknown>;

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['workflow'],
        pipeline_id: pipelineId,
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${planningTask.id}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${planningTask.id}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        output: {
          suggested_plan: { template: 'execution-template', parameters: { sprint: 1 } },
          clarification_questions: [
            { id: 'target-users', question: 'Who are the target support personas?' },
          ],
        },
      },
    });

    const reworkGate = await app.inject({
      method: 'POST',
      url: `/api/v1/pipelines/${pipelineId}/phases/planning/gate`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        action: 'request_changes',
        feedback: 'Need audience clarification before finalizing the plan.',
        override_input: {
          clarification_answers: {
            'target-users': 'Tier 1 support agents and customer success managers',
          },
        },
      },
    });
    expect(reworkGate.statusCode).toBe(200);

    const taskReload = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${planningTask.id}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(taskReload.statusCode).toBe(200);
    expect(taskReload.json().data.state).toBe('ready');
    expect(taskReload.json().data.input.project_brief).toBe(
      'Build a customer support assistant with escalation workflows.',
    );
    expect(taskReload.json().data.input.clarification_answers['target-users']).toBe(
      'Tier 1 support agents and customer success managers',
    );
    expect(taskReload.json().data.input.clarification_history).toHaveLength(1);
    expect(taskReload.json().data.output).toBeNull();
  });
});
