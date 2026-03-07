import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventService } from '../../src/services/event-service.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { TemplateService } from '../../src/services/template-service.js';
import { validateTemplateSchema } from '../../src/orchestration/pipeline-engine.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';

const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
  ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
};

const admin = {
  id: 'admin',
  tenantId,
  scope: 'admin' as const,
  ownerType: 'user',
  ownerId: null,
  keyPrefix: 'admin',
};

describe('pipeline + template full coverage', () => {
  let db: TestDatabase;
  let templateService: TemplateService;
  let pipelineService: PipelineService;
  let taskService: TaskService;
  let artifactRoot: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'agentbaton-platform-state-'));
    const eventService = new EventService(db.pool);
    templateService = new TemplateService(db.pool, eventService);
    pipelineService = new PipelineService(db.pool, eventService, {
      ...config,
      ARTIFACT_LOCAL_ROOT: artifactRoot,
    });
    taskService = new TaskService(db.pool, eventService, {
      ...config,
      ARTIFACT_LOCAL_ROOT: artifactRoot,
    });
  });

  afterAll(async () => {
    await rm(artifactRoot, { recursive: true, force: true });
    await stopTestDatabase(db);
  });

  it('covers FR-161/FR-169/FR-170/FR-171/FR-172/FR-177 pipeline instantiation from template with dependencies', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'full-template',
      slug: 'full-template',
      schema: {
        variables: [{ name: 'feature', type: 'string', required: true }],
        tasks: [
          { id: 'analysis', title_template: 'Analyze ${feature}', type: 'analysis' },
          {
            id: 'code',
            title_template: 'Implement ${feature}',
            type: 'code',
            depends_on: ['analysis'],
          },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'pipeline-full',
      parameters: { feature: 'auth' },
    });

    expect(pipeline.id).toBeTypeOf('string');
    expect(pipeline.template_id).toBe(template.id);
    expect(pipeline.tasks).toHaveLength(2);

    const [a, b] = pipeline.tasks as Array<Record<string, unknown>>;
    expect(a.state).toBe('ready');
    expect(a.title).toBe('Analyze auth');
    expect(b.state).toBe('pending');
    expect((b.depends_on as string[])[0]).toBe(a.id);
  });

  it('persists task context_template into task context for execution-path contracts', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'context-contract-template',
      slug: 'context-contract-template',
      schema: {
        variables: [{ name: 'failure_mode', type: 'string', required: true }],
        tasks: [
          {
            id: 'developer',
            title_template: 'Developer task',
            type: 'code',
            context_template: {
              failure_mode: '${failure_mode}',
              gate: 'ap7',
            },
          },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'context-contract-pipeline',
      parameters: { failure_mode: 'deterministic_impossible' },
    });

    const [task] = pipeline.tasks as Array<Record<string, unknown>>;
    expect(task.context).toEqual({
      failure_mode: 'deterministic_impossible',
      gate: 'ap7',
    });
  });

  it('covers FR-162/FR-167 pipeline status derivation and emitted events', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'state-template',
      slug: 'state-template',
      schema: { tasks: [{ id: 'task', title_template: 'Task', type: 'code' }] },
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'pipeline-state',
    });
    const loaded = await pipelineService.getPipeline(tenantId, pipeline.id as string);

    expect(loaded.state).toBe('pending');

    const eventRows = await db.pool.query(
      `SELECT type FROM events WHERE tenant_id = $1 AND entity_id = $2 AND entity_type = 'pipeline' ORDER BY created_at ASC`,
      [tenantId, pipeline.id],
    );
    expect(eventRows.rows.some((row) => row.type === 'pipeline.created')).toBe(true);
  });

  it('persists output_state declarations and enforces artifact/git/diff storage on completion', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'state-declaration-template',
      slug: 'state-declaration-template',
      schema: {
        tasks: [
          {
            id: 'developer',
            title_template: 'Developer task',
            type: 'code',
            output_state: {
              report: { mode: 'artifact', path: 'reports/report.json' },
              branch: { mode: 'git', summary: 'workspace branch' },
              patch: { mode: 'diff' },
            },
          },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'state-declaration-pipeline',
      metadata: {
        artifact_retention: { mode: 'days', days: 7 },
      },
    });

    const [task] = pipeline.tasks as Array<Record<string, unknown>>;
    expect((task.metadata as Record<string, unknown>).output_state).toMatchObject({
      report: { mode: 'artifact', path: 'reports/report.json' },
      branch: { mode: 'git', summary: 'workspace branch' },
      patch: { mode: 'diff' },
    });

    const agentId = randomUUID();

    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'state-agent',ARRAY['typescript'],'busy',30,$3)`,
      [agentId, tenantId, task.id],
    );
    await db.pool.query(
      `UPDATE tasks
          SET state = 'running',
              assigned_agent_id = $3,
              started_at = now(),
              claimed_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, task.id, agentId],
    );

    const completed = await taskService.completeTask(
      {
        id: 'state-key',
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agentId,
        keyPrefix: 'st',
      },
      task.id as string,
      {
        output: {
          report: { ok: true, score: 1 },
          branch: 'baton/task-123',
          patch:
            'diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1,2 @@\n+console.log("ok");\n',
        },
        git_info: {
          branch: 'baton/task-123',
          commit_hash: 'abc123',
        },
      },
    );

    expect((completed.output as Record<string, unknown>).report).toMatchObject({
      type: 'artifact',
      location: expect.stringContaining('artifact:'),
    });
    expect((completed.output as Record<string, unknown>).branch).toMatchObject({
      type: 'git',
      location: 'git:commit:abc123',
    });
    expect((completed.output as Record<string, unknown>).patch).toMatchObject({
      type: 'diff',
      location: expect.stringContaining(`diff:${task.id as string}/patch`),
    });
    expect((completed.git_info as Record<string, unknown>).declared_outputs).toMatchObject({
      branch: 'baton/task-123',
    });
    expect((completed.git_info as Record<string, unknown>).declared_diffs).toMatchObject({
      patch: expect.stringContaining('diff --git'),
    });

    const artifacts = await db.pool.query(
      'SELECT logical_path FROM pipeline_artifacts WHERE tenant_id = $1 AND task_id = $2',
      [tenantId, task.id],
    );
    expect(artifacts.rowCount).toBe(1);
    expect(artifacts.rows[0].logical_path).toContain('reports/report.json');
  });

  it('covers FR-173/FR-400/FR-404/FR-700/FR-716 template validation rejects invalid dags and accepts metadata blocks', () => {
    expect(() =>
      validateTemplateSchema({
        tasks: [
          { id: 'a', title_template: 'A', type: 'code', depends_on: ['b'] },
          { id: 'b', title_template: 'B', type: 'test', depends_on: ['a'] },
        ],
      }),
    ).toThrow(/cycle/i);

    const validated = validateTemplateSchema({
      metadata: {
        quality: { lint: 'strict' },
        workflow: { phases: [{ id: 'build', gate: 'all_complete' }] },
      },
      tasks: [{ id: 'a', title_template: 'A', type: 'code', role_config: { prompt: 'do A' } }],
    });

    expect(validated.tasks[0].role_config).toEqual({ prompt: 'do A' });
    expect(validated.metadata).toMatchObject({ quality: { lint: 'strict' } });
  });

  it('covers FR-174/FR-175/FR-176 built-in template listing, versioning and pagination', async () => {
    await db.pool.query(
      `INSERT INTO templates (tenant_id, name, slug, version, is_built_in, is_published, schema)
       VALUES ($1,'built-in-a','builtin-a',1,true,true,$2::jsonb),
              ($1,'built-in-b','builtin-b',1,true,true,$2::jsonb)`,
      [tenantId, JSON.stringify({ tasks: [{ id: 'x', title_template: 'X', type: 'code' }] })],
    );

    const created = await templateService.createTemplate(admin, {
      name: 'versioned-template',
      slug: 'versioned-template',
      schema: { tasks: [{ id: 'x', title_template: 'X', type: 'code' }] },
    });
    const updated = await templateService.updateTemplate(admin, created.id as string, {
      schema: { tasks: [{ id: 'x', title_template: 'X2', type: 'code' }] },
    });

    expect(updated.version).toBe(2);

    const builtInPage = await templateService.listTemplates(tenantId, {
      is_built_in: true,
      page: 1,
      per_page: 1,
    });
    expect(builtInPage.data).toHaveLength(1);
    expect(builtInPage.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('covers FR-401/FR-402/FR-406/FR-409/FR-410/FR-411 template CRUD and role resolution on instantiation', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'roles-template',
      slug: 'roles-template',
      schema: {
        variables: [{ name: 'lang', type: 'string', default: 'ts' }],
        tasks: [
          {
            id: 'implement',
            title_template: 'Implement in ${lang}',
            type: 'code',
            role: 'engineer',
          },
        ],
      },
    });

    const fetched = (await templateService.getTemplate(tenantId, template.id as string)) as Record<
      string,
      unknown
    >;
    expect(fetched.slug).toBe('roles-template');

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'roles-pipeline',
    });
    const [task] = pipeline.tasks as Array<Record<string, unknown>>;

    expect(task.role).toBe('engineer');
    expect(task.title).toBe('Implement in ts');

    await expect(
      templateService.softDeleteTemplate(admin, template.id as string),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('covers FR-701/FR-702/FR-703/FR-704/FR-706/FR-707/FR-708/FR-718/FR-720 workflow-related data is accepted and persisted', async () => {
    const schema = {
      metadata: {
        workflow: {
          phases: [
            { id: 'p1', gate: 'all_complete', parallel: false },
            { id: 'p2', gate: 'manual', parallel: true },
          ],
          blocked_by_alias: 'depends_on',
        },
      },
      tasks: [
        { id: 'a', title_template: 'A', type: 'code' },
        { id: 'b', title_template: 'B', type: 'test', depends_on: ['a'] },
      ],
    };

    const template = await templateService.createTemplate(admin, {
      name: 'workflow-template',
      slug: 'workflow-template',
      schema,
    });

    const loaded = (await templateService.getTemplate(tenantId, template.id as string)) as Record<
      string,
      unknown
    >;
    expect((loaded.schema as Record<string, unknown>).metadata).toMatchObject(
      schema.metadata as Record<string, unknown>,
    );
  });

  it('covers FR-412/FR-822/FR-824 environment and worker instructions are stored on template tasks', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'environment-template',
      slug: 'environment-template',
      schema: {
        tasks: [
          {
            id: 'runner',
            title_template: 'Run',
            type: 'custom',
            role_config: { instruction: 'execute script' },
            environment: { RUNTIME: 'openclaw' },
          },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'env-pipeline',
    });
    const [task] = pipeline.tasks as Array<Record<string, unknown>>;

    expect(task.role_config).toEqual({ instruction: 'execute script' });
    expect(task.environment).toEqual({ RUNTIME: 'openclaw' });
  });
});
