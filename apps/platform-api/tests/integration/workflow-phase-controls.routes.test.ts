import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiKey } from '../../src/auth/api-key.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

describe('workflow phase control routes', () => {
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

    const workflowResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateResponse.json().data.id,
        name: 'phase gate workflow',
      },
    });
    expect(workflowResponse.statusCode).toBe(201);
    const workflowId = workflowResponse.json().data.id as string;
    const taskId = workflowResponse.json().data.tasks[0].id as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['workflow'],
        workflow_id: workflowId,
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
      url: `/api/v1/workflows/${workflowId}/phases/plan/gate`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { action: 'approve' },
    });
    expect(gateResponse.statusCode).toBe(200);
    expect(gateResponse.json().data.current_phase).toBe('ship');

    const workflowReload = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${workflowId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(workflowReload.statusCode).toBe(200);
    const phases = workflowReload.json().data.phases as Array<Record<string, unknown>>;
    expect(phases.find((phase) => phase.name === 'plan')?.gate_status).toBe('approved');
    expect(phases.find((phase) => phase.name === 'ship')?.status).toBe('active');
    const tasks = workflowReload.json().data.tasks as Array<Record<string, unknown>>;
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

    const workflowResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        template_id: templateResponse.json().data.id,
        name: 'phase cancel workflow',
      },
    });
    expect(workflowResponse.statusCode).toBe(201);
    const workflowId = workflowResponse.json().data.id as string;

    await db.pool.query(
      `UPDATE tasks
          SET state = CASE
            WHEN metadata->>'workflow_phase' = 'plan' THEN 'completed'::task_state
            WHEN metadata->>'workflow_phase' = 'build' THEN 'ready'::task_state
            ELSE 'pending'::task_state
          END
        WHERE tenant_id = $1
          AND workflow_id = $2`,
      [tenantId, workflowId],
    );

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${workflowId}/phases/build/cancel`,
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(cancelResponse.statusCode).toBe(200);

    const workflowReload = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${workflowId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    const phases = workflowReload.json().data.phases as Array<Record<string, unknown>>;
    expect(phases.find((phase) => phase.name === 'build')?.status).toBe('cancelled');
    expect(phases.find((phase) => phase.name === 'ship')?.status).toBe('cancelled');
    const tasks = workflowReload.json().data.tasks as Array<Record<string, unknown>>;
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

  it('creates a planning workflow and resumes the same planning task with clarification answers', async () => {
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

    const workflowResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/planning-workflow`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        brief: 'Build a customer support assistant with escalation workflows.',
      },
    });
    expect(workflowResponse.statusCode).toBe(201);
    expect(workflowResponse.json().data.metadata.planning_workflow).toBe(true);

    const workflowId = workflowResponse.json().data.id as string;
    const planningTask = workflowResponse.json().data.tasks[0] as Record<string, unknown>;

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['workflow'],
        workflow_id: workflowId,
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
      url: `/api/v1/workflows/${workflowId}/phases/planning/gate`,
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

  it('chains a planning workflow into an execution workflow and records project timeline summaries', async () => {
    const executionTemplate = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'Execution Template',
        slug: `execution-template-${Date.now()}`,
        schema: {
          tasks: [{ id: 'build', title_template: 'Build sprint {{sprint}}', type: 'code' }],
        },
      },
    });
    expect(executionTemplate.statusCode).toBe(201);

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        name: 'Timeline Project',
        slug: `timeline-project-${Date.now()}`,
      },
    });
    const projectId = projectResponse.json().data.id as string;

    const planningWorkflowResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/planning-workflow`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        brief: 'Plan sprint one for a billing dashboard.',
      },
    });
    expect(planningWorkflowResponse.statusCode).toBe(201);
    const planningWorkflowId = planningWorkflowResponse.json().data.id as string;
    const planningTaskId = planningWorkflowResponse.json().data.tasks[0].id as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['workflow'],
        workflow_id: planningWorkflowId,
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${planningTaskId}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${planningTaskId}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        git_info: {
          commit_hash: 'plan123',
          linked_prs: [{ number: 42, title: 'Plan sprint one' }],
        },
        output: {
          suggested_plan: {
            template: executionTemplate.json().data.id,
            parameters: { sprint: 1 },
          },
        },
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${planningWorkflowId}/phases/planning/gate`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { action: 'approve' },
    });

    const chainedWorkflowResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${planningWorkflowId}/chain`,
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { name: 'Execution Sprint 1' },
    });
    expect(chainedWorkflowResponse.statusCode).toBe(201);
    expect(chainedWorkflowResponse.json().data.project_id).toBe(projectId);
    expect(chainedWorkflowResponse.json().data.metadata.chain_source_workflow_id).toBe(
      planningWorkflowId,
    );

    const chainedWorkflowId = chainedWorkflowResponse.json().data.id as string;
    const chainedTaskId = chainedWorkflowResponse.json().data.tasks[0].id as string;
    await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/claim',
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        capabilities: ['workflow'],
        workflow_id: chainedWorkflowId,
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${chainedTaskId}/start`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { agent_id: agentId },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${chainedTaskId}/complete`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        agent_id: agentId,
        output: { delivered: true },
      },
    });

    const timelineResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/timeline`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(timelineResponse.statusCode).toBe(200);
    expect(timelineResponse.json().data).toHaveLength(2);
    expect(
      timelineResponse.json().data.some(
        (entry: Record<string, unknown>) =>
          entry.workflow_id === planningWorkflowId &&
          (
            ((entry.chain as Record<string, unknown>).child_workflow_ids as string[] | undefined) ??
            []
          ).includes(chainedWorkflowId),
      ),
    ).toBe(true);
    expect(
      timelineResponse.json().data.some(
        (entry: Record<string, unknown>) =>
          entry.workflow_id === chainedWorkflowId &&
          (entry.chain as Record<string, unknown>).source_workflow_id === planningWorkflowId,
      ),
    ).toBe(true);

    const planningSummary = (timelineResponse.json().data as Array<Record<string, unknown>>).find(
      (entry) => entry.workflow_id === planningWorkflowId,
    ) as Record<string, unknown>;
    expect(planningSummary.kind).toBe('run_summary');
    expect(planningSummary.phase_metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'planning',
          task_counts: expect.objectContaining({ completed: 1, total: 1 }),
          gate_history: expect.arrayContaining([
            expect.objectContaining({ action: 'approved' }),
          ]),
        }),
      ]),
    );
    expect(planningSummary.produced_artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'commit', commit_hash: 'plan123' }),
        expect.objectContaining({ kind: 'pull_request' }),
      ]),
    );
  });
});
