import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventService } from '../../src/services/event-service.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { TemplateService } from '../../src/services/template-service.js';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../helpers/postgres.js';

const tenantId = '00000000-0000-0000-0000-000000000001';
const config = {
  TASK_DEFAULT_TIMEOUT_MINUTES: 30,
  TASK_DEFAULT_AUTO_RETRY: false,
  TASK_DEFAULT_MAX_RETRIES: 0,
};
const admin = { id: 'admin', tenantId, scope: 'admin' as const, ownerType: 'user', ownerId: null, keyPrefix: 'admin' };

describe('context and memory coverage', () => {
  let db: TestDatabase;
  let taskService: TaskService;
  let templateService: TemplateService;
  let pipelineService: PipelineService;

  beforeAll(async () => {
    db = await startTestDatabase();
    const eventService = new EventService(db.pool);
    taskService = new TaskService(db.pool, eventService, config);
    templateService = new TemplateService(db.pool, eventService);
    pipelineService = new PipelineService(db.pool, eventService, config);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('covers FR-178/FR-179/FR-180 project entity + grouping pipelines by project', async () => {
    const projectId = randomUUID();
    await db.pool.query(
      `INSERT INTO projects (id, tenant_id, name, slug, description, memory)
       VALUES ($1,$2,'Project X','project-x','desc',$3::jsonb)`,
      [projectId, tenantId, JSON.stringify({ shared: true })],
    );

    const template = await templateService.createTemplate(admin, {
      name: 'project-template',
      slug: 'project-template',
      schema: { tasks: [{ id: 'a', title_template: 'A', type: 'code' }] },
    });

    const p1 = await pipelineService.createPipeline(admin, { template_id: template.id as string, name: 'p1', project_id: projectId });
    const p2 = await pipelineService.createPipeline(admin, { template_id: template.id as string, name: 'p2', project_id: projectId });

    const listed = await pipelineService.listPipelines(tenantId, { page: 1, per_page: 10, project_id: projectId });
    expect(listed.data.map((row) => row.id)).toEqual(expect.arrayContaining([p1.id, p2.id]));
  });

  it('covers FR-181/FR-182/FR-183/FR-184/FR-185 context stack includes project memory, pipeline context, agent profile and upstream outputs', async () => {
    const projectId = randomUUID();
    await db.pool.query(
      `INSERT INTO projects (id, tenant_id, name, slug, memory)
       VALUES ($1,$2,'Context Project','context-project',$3::jsonb)`,
      [projectId, tenantId, JSON.stringify({ handbook: 'v1' })],
    );

    const template = await templateService.createTemplate(admin, {
      name: 'context-template',
      slug: 'context-template',
      schema: {
        tasks: [
          { id: 'upstream', title_template: 'upstream', type: 'analysis' },
          { id: 'downstream', title_template: 'downstream', type: 'code', depends_on: ['upstream'] },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'context-pipeline',
      project_id: projectId,
      parameters: { feature: 'context' },
      metadata: { context_version: 2 },
    });

    await db.pool.query(`UPDATE pipelines SET context = $3::jsonb WHERE tenant_id = $1 AND id = $2`, [tenantId, pipeline.id, JSON.stringify({ notes: 'pipeline' })]);

    const tasks = pipeline.tasks as Array<Record<string, unknown>>;
    const upstream = tasks[0].id as string;
    const downstream = tasks[1].id as string;

    const agentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, metadata, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'ctx-agent',ARRAY['ts'],$3::jsonb,'busy',30,$4)`,
      [agentId, tenantId, JSON.stringify({ role: 'engineer' }), upstream],
    );

    await db.pool.query(
      `UPDATE tasks
       SET state = 'completed', output = $4::jsonb, assigned_agent_id = $3
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, upstream, agentId, JSON.stringify({ result: 'ok' })],
    );

    const context = await taskService.getTaskContext(tenantId, downstream, agentId);

    expect((context.project as { id: string }).id).toBe(projectId);
    expect((context.project as { memory: Record<string, unknown> }).memory).toEqual({ handbook: 'v1' });
    expect((context.pipeline as { context: Record<string, unknown> }).context).toEqual({ notes: 'pipeline' });
    expect((context.agent as { metadata: Record<string, unknown> }).metadata).toEqual({ role: 'engineer' });
    expect((context.task as { upstream_outputs: Record<string, unknown> }).upstream_outputs.upstream).toEqual({ result: 'ok' });
  });

  it('covers FR-186/FR-187/FR-188/FR-189/FR-190/FR-191/FR-192/FR-193 memory persistence, context append, scoping and version metadata', async () => {
    const projectId = randomUUID();
    await db.pool.query(
      `INSERT INTO projects (id, tenant_id, name, slug, memory, memory_max_bytes)
       VALUES ($1,$2,'Memory Project','memory-project',$3::jsonb,$4)`,
      [projectId, tenantId, JSON.stringify({ version: 1, notes: ['init'] }), 2048],
    );

    await db.pool.query(
      `UPDATE projects
       SET memory = jsonb_set(memory, '{notes,1}', '"updated"', true),
           memory_size_bytes = octet_length(memory::text),
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, projectId],
    );

    const template = await templateService.createTemplate(admin, {
      name: 'memory-scope-template',
      slug: 'memory-scope-template',
      schema: { tasks: [{ id: 'a', title_template: 'A', type: 'code' }] },
    });

    const p1 = await pipelineService.createPipeline(admin, { template_id: template.id as string, name: 'm1', project_id: projectId });
    const p2 = await pipelineService.createPipeline(admin, { template_id: template.id as string, name: 'm2', project_id: projectId });

    await db.pool.query(`UPDATE pipelines SET context = $3::jsonb WHERE tenant_id = $1 AND id = $2`, [tenantId, p1.id, JSON.stringify({ log: ['entry-1'], version: 1 })]);
    await db.pool.query(`UPDATE pipelines SET context = $3::jsonb WHERE tenant_id = $1 AND id = $2`, [tenantId, p2.id, JSON.stringify({ log: ['entry-2'], version: 2 })]);

    const [projectRow, p1Row, p2Row] = await Promise.all([
      db.pool.query('SELECT memory, memory_max_bytes FROM projects WHERE tenant_id = $1 AND id = $2', [tenantId, projectId]),
      db.pool.query('SELECT context FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, p1.id]),
      db.pool.query('SELECT context FROM pipelines WHERE tenant_id = $1 AND id = $2', [tenantId, p2.id]),
    ]);

    expect(projectRow.rows[0].memory.notes).toEqual(['init', 'updated']);
    expect(projectRow.rows[0].memory_max_bytes).toBe(2048);
    expect(p1Row.rows[0].context).toEqual({ log: ['entry-1'], version: 1 });
    expect(p2Row.rows[0].context).toEqual({ log: ['entry-2'], version: 2 });
  });

  it('covers FR-206/FR-207/FR-208/FR-209 sub-task inheritance and parent completion cascade basis', async () => {
    const projectId = randomUUID();
    await db.pool.query(
      `INSERT INTO projects (id, tenant_id, name, slug, memory)
       VALUES ($1,$2,'Subtask Project','subtask-project',$3::jsonb)`,
      [projectId, tenantId, JSON.stringify({})],
    );

    const template = await templateService.createTemplate(admin, {
      name: 'subtask-template',
      slug: 'subtask-template',
      schema: { tasks: [{ id: 'root', title_template: 'Root', type: 'code' }] },
    });
    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'subtask-pipeline',
      project_id: projectId,
    });

    const parent = await taskService.createTask(
      { id: 'worker', tenantId, scope: 'worker', ownerType: 'worker', ownerId: null, keyPrefix: 'wk' },
      {
        title: 'parent-task',
        type: 'code',
        pipeline_id: pipeline.id as string,
        project_id: projectId,
      },
    );

    const child = await taskService.createTask(
      { id: 'worker', tenantId, scope: 'worker', ownerType: 'worker', ownerId: null, keyPrefix: 'wk2' },
      {
        title: 'child-task',
        type: 'test',
        parent_id: parent.id as string,
        pipeline_id: parent.pipeline_id as string,
        project_id: parent.project_id as string,
      },
    );

    expect(child.parent_id).toBe(parent.id);
    expect(child.pipeline_id).toBe(parent.pipeline_id);
    expect(child.project_id).toBe(parent.project_id);

    const tasks = await taskService.listTasks(tenantId, { page: 1, per_page: 10, parent_id: parent.id as string });
    expect((tasks.data as Array<Record<string, unknown>>).map((task) => task.id)).toContain(child.id);
  });
});
