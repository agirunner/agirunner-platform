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

const architectDocumentPath = 'handoffs/architect/architecture-design.md';
const developerHandoffPath = 'handoffs/developer/implementation-handoff.md';
const reviewerReportPath = 'handoffs/reviewer/review-report.md';
const qaReportPath = 'handoffs/qa/validation-report.md';

function sdlcOutputContractTemplate(): Record<string, unknown> {
  return {
    variables: [
      { name: 'repo', type: 'string', required: true },
      { name: 'goal', type: 'string', required: true },
      { name: 'branch', type: 'string', required: false, default: 'main' },
      { name: 'git_token', type: 'string', required: false, default: '' },
      { name: 'git_ssh_private_key', type: 'string', required: false, default: '' },
      { name: 'git_ssh_known_hosts', type: 'string', required: false, default: '' },
      { name: 'git_user_name', type: 'string', required: false, default: 'AgentBaton' },
      { name: 'git_user_email', type: 'string', required: false, default: 'agentbaton@example.com' },
    ],
    tasks: [
      {
        id: 'architect',
        title_template: 'Architecture: {{goal}}',
        type: 'analysis',
        role: 'architect',
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: {
            git_token: '{{git_token}}',
            git_ssh_private_key: '{{git_ssh_private_key}}',
            git_ssh_known_hosts: '{{git_ssh_known_hosts}}',
          },
          instruction:
            `Design {{goal}} in {{repo}}. Do not implement, commit, or push. Produce a structured architecture handoff and set design_document to markdown content that the platform will persist at ${architectDocumentPath} for the developer stage.`,
        },
        environment: {
          repository_url: '{{repo}}',
          branch: '{{branch}}',
          git_user_name: '{{git_user_name}}',
          git_user_email: '{{git_user_email}}',
        },
        role_config: {
          tools: ['file_read', 'file_list', 'git_status', 'git_diff'],
          system_prompt:
            'Return JSON only. Stay in design mode. Do not implement code, modify application source files, ' +
            'create commits, or push branches. Use only read-only analysis tools. Produce ' +
            'architecture_summary, design_decisions, implementation_handoff, and design_document. Set design_document ' +
            'to the markdown content for the design artifact; the platform persists it automatically at ' +
            `${architectDocumentPath}. The developer stage consumes ` +
            'architecture_summary, design_decisions, implementation_handoff, and the persisted design_document ' +
            'from that path as its source of truth.',
          output_schema: {
            type: 'object',
            required: [
              'architecture_summary',
              'design_decisions',
              'implementation_handoff',
              'design_document',
            ],
            properties: {
              architecture_summary: { type: 'string', minLength: 1 },
              design_decisions: { type: 'array', items: { type: 'string', minLength: 1 } },
              implementation_handoff: { type: 'string', minLength: 1 },
              design_document: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        output_state: {
          architecture_summary: 'inline',
          design_decisions: 'inline',
          implementation_handoff: 'inline',
          design_document: {
            mode: 'artifact',
            path: architectDocumentPath,
            media_type: 'text/markdown; charset=utf-8',
          },
        },
      },
      {
        id: 'developer',
        title_template: 'Develop: {{goal}}',
        type: 'code',
        role: 'developer',
        depends_on: ['architect'],
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: {
            git_token: '{{git_token}}',
            git_ssh_private_key: '{{git_ssh_private_key}}',
            git_ssh_known_hosts: '{{git_ssh_known_hosts}}',
          },
          instruction:
            `Implement {{goal}} in {{repo}} using the architect handoff and persisted design document as the source of truth. Set implementation_handoff to markdown content that the platform will persist at ${developerHandoffPath} for reviewer and QA consumption.`,
        },
        environment: {
          repository_url: '{{repo}}',
          branch: '{{branch}}',
          git_user_name: '{{git_user_name}}',
          git_user_email: '{{git_user_email}}',
        },
        context_template: {
          handoff_contract: {
            architect: [
              'architecture_summary',
              'design_decisions',
              'implementation_handoff',
              'design_document',
            ],
          },
        },
        role_config: {
          system_prompt:
            'Return JSON only. Read upstream_outputs.architect.architecture_summary, ' +
            'upstream_outputs.architect.design_decisions, upstream_outputs.architect.implementation_handoff, ' +
            `and upstream_outputs.architect.design_document from ${architectDocumentPath}. Produce ` +
            'implementation_summary, files_changed, branch, change_diff, and implementation_handoff. Set ' +
            `implementation_handoff to markdown content that the platform will persist at ${developerHandoffPath}. The reviewer stage ` +
            `consumes implementation_summary, files_changed, branch, change_diff, and ${developerHandoffPath}; ` +
            `the QA stage also consumes ${developerHandoffPath}.`,
          output_schema: {
            type: 'object',
            required: [
              'implementation_summary',
              'files_changed',
              'branch',
              'change_diff',
              'implementation_handoff',
            ],
            properties: {
              implementation_summary: { type: 'string', minLength: 1 },
              files_changed: { type: 'array', items: { type: 'string', minLength: 1 } },
              branch: { type: 'string', minLength: 1 },
              change_diff: { type: 'string', minLength: 1 },
              implementation_handoff: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        output_state: {
          implementation_summary: 'inline',
          files_changed: 'inline',
          branch: { mode: 'git' },
          change_diff: { mode: 'diff' },
          implementation_handoff: {
            mode: 'artifact',
            path: developerHandoffPath,
            media_type: 'text/markdown; charset=utf-8',
          },
        },
      },
      {
        id: 'reviewer',
        title_template: 'Review: {{goal}}',
        type: 'review',
        role: 'reviewer',
        depends_on: ['developer'],
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: {
            git_token: '{{git_token}}',
            git_ssh_private_key: '{{git_ssh_private_key}}',
            git_ssh_known_hosts: '{{git_ssh_known_hosts}}',
          },
          instruction:
            `Review the developer implementation for {{goal}} in {{repo}}. Consume the implementation handoff from ${developerHandoffPath} and set review_report to markdown content that the platform will persist at ${reviewerReportPath} for QA.`,
        },
        environment: {
          repository_url: '{{repo}}',
          branch: '{{branch}}',
          git_user_name: '{{git_user_name}}',
          git_user_email: '{{git_user_email}}',
        },
        context_template: {
          handoff_contract: {
            developer: [
              'implementation_summary',
              'files_changed',
              'branch',
              'change_diff',
              'implementation_handoff',
            ],
          },
        },
        role_config: {
          system_prompt:
            'Return JSON only. Review upstream_outputs.developer.implementation_summary, files_changed, ' +
            `branch, change_diff, and implementation_handoff from ${developerHandoffPath}. Produce ` +
            `review_outcome, review_summary, blocking_issues, and review_report. Set review_report to markdown content that the platform will persist at ${reviewerReportPath}. ` +
            `The QA stage consumes review_outcome, review_summary, blocking_issues, and ${reviewerReportPath}.`,
          output_schema: {
            type: 'object',
            required: ['review_outcome', 'review_summary', 'blocking_issues', 'review_report'],
            properties: {
              review_outcome: { enum: ['approved', 'changes_requested', 'rejected'] },
              review_summary: { type: 'string', minLength: 1 },
              blocking_issues: { type: 'array', items: { type: 'string', minLength: 1 } },
              review_report: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        output_state: {
          review_outcome: 'inline',
          review_summary: 'inline',
          blocking_issues: 'inline',
          review_report: {
            mode: 'artifact',
            path: reviewerReportPath,
            media_type: 'text/markdown; charset=utf-8',
          },
        },
      },
      {
        id: 'qa',
        title_template: 'QA: {{goal}}',
        type: 'test',
        role: 'qa',
        depends_on: ['reviewer'],
        input_template: {
          repo: '{{repo}}',
          goal: '{{goal}}',
          credentials: {
            git_token: '{{git_token}}',
            git_ssh_private_key: '{{git_ssh_private_key}}',
            git_ssh_known_hosts: '{{git_ssh_known_hosts}}',
          },
          instruction:
            `Validate {{goal}} in {{repo}} using the developer handoff at ${developerHandoffPath} and the reviewer report at ${reviewerReportPath}. Set validation_report to markdown content that the platform will persist at ${qaReportPath}.`,
        },
        environment: {
          repository_url: '{{repo}}',
          branch: '{{branch}}',
          git_user_name: '{{git_user_name}}',
          git_user_email: '{{git_user_email}}',
        },
        context_template: {
          handoff_contract: {
            developer: [
              'implementation_summary',
              'files_changed',
              'branch',
              'change_diff',
              'implementation_handoff',
            ],
            reviewer: ['review_outcome', 'review_summary', 'blocking_issues', 'review_report'],
          },
        },
        role_config: {
          system_prompt:
            'Return JSON only. Validate upstream_outputs.developer and upstream_outputs.reviewer. Consume the ' +
            `developer implementation handoff from ${developerHandoffPath} and the reviewer report from ${reviewerReportPath}. ` +
            `Produce qa_outcome, validation_summary, executed_checks, and validation_report. Set validation_report to markdown content that the platform will persist at ${qaReportPath} as the final stage output.`,
          output_schema: {
            type: 'object',
            required: ['qa_outcome', 'validation_summary', 'executed_checks', 'validation_report'],
            properties: {
              qa_outcome: { enum: ['passed', 'failed', 'blocked'] },
              validation_summary: { type: 'string', minLength: 1 },
              executed_checks: { type: 'array', items: { type: 'string', minLength: 1 } },
              validation_report: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        output_state: {
          qa_outcome: 'inline',
          validation_summary: 'inline',
          executed_checks: 'inline',
          validation_report: {
            mode: 'artifact',
            path: qaReportPath,
            media_type: 'text/markdown; charset=utf-8',
          },
        },
      },
    ],
  };
}

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

  it('instantiates the SDLC output contract and exposes architect handoff via output_state and documents', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'sdlc-output-contract-template',
      slug: 'sdlc-output-contract-template',
      schema: sdlcOutputContractTemplate(),
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'sdlc-output-contract-pipeline',
      parameters: {
        repo: 'playground-repo',
        goal: 'Add explicit SDLC handoffs',
      },
      metadata: {
        artifact_retention: { mode: 'days', days: 7 },
      },
    });

    const tasks = pipeline.tasks as Array<Record<string, unknown>>;
    const architectTask = tasks.find((task) => task.role === 'architect');
    const developerTask = tasks.find((task) => task.role === 'developer');
    const reviewerTask = tasks.find((task) => task.role === 'reviewer');
    const qaTask = tasks.find((task) => task.role === 'qa');

    expect(architectTask?.metadata).toMatchObject({
      output_state: {
        design_document: { mode: 'artifact', path: architectDocumentPath },
      },
    });
    expect(developerTask?.metadata).toMatchObject({
      output_state: {
        branch: { mode: 'git' },
        change_diff: { mode: 'diff' },
        implementation_handoff: { mode: 'artifact', path: developerHandoffPath },
      },
    });
    expect(reviewerTask?.metadata).toMatchObject({
      output_state: {
        review_report: { mode: 'artifact', path: reviewerReportPath },
      },
    });
    expect(qaTask?.metadata).toMatchObject({
      output_state: {
        validation_report: { mode: 'artifact', path: qaReportPath },
      },
    });

    expect((architectTask?.role_config as Record<string, unknown>).output_schema).toBeDefined();
    expect((architectTask?.role_config as Record<string, unknown>).tools).toEqual([
      'file_read',
      'file_list',
      'git_status',
      'git_diff',
    ]);
    expect((architectTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining('Do not implement code, modify application source files, create commits, or push branches'),
    );
    expect((architectTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining('Set design_document to the markdown content'),
    );
    expect((developerTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining(developerHandoffPath),
    );
    expect((developerTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining('reviewer stage consumes'),
    );
    expect((reviewerTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining(reviewerReportPath),
    );
    expect((reviewerTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining('QA stage consumes'),
    );
    expect((qaTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining(developerHandoffPath),
    );
    expect((qaTask?.role_config as Record<string, unknown>).system_prompt).toEqual(
      expect.stringContaining(reviewerReportPath),
    );
    expect((developerTask?.context as Record<string, unknown>).handoff_contract).toEqual({
      architect: [
        'architecture_summary',
        'design_decisions',
        'implementation_handoff',
        'design_document',
      ],
    });

    const architectAgentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'architect-agent',ARRAY['architect'],'busy',30,$3)`,
      [architectAgentId, tenantId, architectTask?.id],
    );
    await db.pool.query(
      `UPDATE tasks
          SET state = 'running',
              assigned_agent_id = $3,
              started_at = now(),
              claimed_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, architectTask?.id, architectAgentId],
    );

    await taskService.completeTask(
      {
        id: 'architect-agent-key',
        tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: architectAgentId,
        keyPrefix: 'arc',
      },
      architectTask?.id as string,
      {
        output: {
          architecture_summary: 'Use explicit artifact-backed handoffs.',
          design_decisions: ['Persist the design doc as an artifact', 'Keep summaries inline'],
          implementation_handoff: 'Developer should follow the persisted architecture design.',
          design_document: '# Architecture\n\nUse output_state-backed handoffs.\n',
        },
      },
    );

    const developerAgentId = randomUUID();
    await db.pool.query(
      `INSERT INTO agents (id, tenant_id, name, capabilities, status, heartbeat_interval_seconds, current_task_id)
       VALUES ($1,$2,'developer-agent',ARRAY['developer'],'busy',30,$3)`,
      [developerAgentId, tenantId, developerTask?.id],
    );

    const developerContext = await taskService.getTaskContext(
      tenantId,
      developerTask?.id as string,
      developerAgentId,
    );

    expect(
      (developerContext.task as { upstream_outputs: Record<string, Record<string, unknown>> }).upstream_outputs
        .architect,
    ).toMatchObject({
      architecture_summary: 'Use explicit artifact-backed handoffs.',
      implementation_handoff: 'Developer should follow the persisted architecture design.',
      design_document: {
        type: 'artifact',
        location: expect.stringContaining(architectDocumentPath),
      },
    });
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

  it('substitutes template variables inside task environment declarations', async () => {
    const template = await templateService.createTemplate(admin, {
      name: 'environment-variable-template',
      slug: 'environment-variable-template',
      schema: {
        variables: [
          { name: 'repo', type: 'string', required: true },
          { name: 'branch', type: 'string', required: false, default: 'main' },
        ],
        tasks: [
          {
            id: 'developer',
            title_template: 'Implement {{repo}}',
            type: 'code',
            environment: {
              repository_url: '{{repo}}',
              branch: '{{branch}}',
            },
          },
        ],
      },
    });

    const pipeline = await pipelineService.createPipeline(admin, {
      template_id: template.id as string,
      name: 'environment-variable-pipeline',
      parameters: {
        repo: 'https://github.com/octocat/Hello-World.git',
      },
    });

    const [task] = pipeline.tasks as Array<Record<string, unknown>>;
    expect(task.environment).toEqual({
      repository_url: 'https://github.com/octocat/Hello-World.git',
      branch: 'main',
    });
  });
});
