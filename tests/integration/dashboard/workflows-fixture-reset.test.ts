import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_ID } from './support/platform-env.js';
import { sqlText, sqlUuid } from './support/workflows-common.js';
import { resetWorkflowsState } from './support/workflows-fixture-reset.js';
import { buildWorkflowLoadSeedSql } from './support/workflows-load-seed.js';
import { runPsql } from './support/workflows-runtime.js';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000201';
const PLANNED_PLAYBOOK_ID = '00000000-0000-0000-0000-000000000202';
const ONGOING_PLAYBOOK_ID = '00000000-0000-0000-0000-000000000203';
const ORCHESTRATOR_TASK_ID = '00000000-0000-4000-8000-00000000cafe';

describe('resetWorkflowsState', () => {
  afterEach(async () => {
    await resetWorkflowsState();
  });

  it('purges fixture workflows even when an orchestrator heartbeat task exists', async () => {
    await resetWorkflowsState();
    runPsql(buildFixtureSql());

    const workflowId = selectScalar(`
      SELECT id::text
        FROM public.workflows
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND name = 'E2E Perf Workflow 00001'
       LIMIT 1;
    `);
    expect(workflowId).toBeTruthy();

    runPsql(`
      INSERT INTO public.tasks (
        id,
        tenant_id,
        workflow_id,
        workspace_id,
        work_item_id,
        stage_name,
        title,
        role,
        state,
        state_changed_at,
        input,
        metadata,
        created_at,
        updated_at,
        context
      ) VALUES (
        ${sqlUuid(ORCHESTRATOR_TASK_ID)},
        ${sqlUuid(DEFAULT_TENANT_ID)},
        ${sqlUuid(workflowId)},
        ${sqlUuid(WORKSPACE_ID)},
        NULL,
        ${sqlText('intake')},
        ${sqlText('Orchestrate E2E Perf Workflow 00001')},
        ${sqlText('orchestrator')},
        'ready'::task_state,
        ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz,
        ${sqlText(JSON.stringify({
          activation_reason: 'heartbeat',
          activation_dispatch_attempt: 1,
        }))}::jsonb,
        ${sqlText(JSON.stringify({
          activation_reason: 'heartbeat',
          activation_dispatch_attempt: 1,
        }))}::jsonb,
        ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz,
        ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz,
        '{}'::jsonb
      );
    `);

    expect(selectScalar(`
      SELECT COUNT(*)
        FROM public.tasks
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND workflow_id = ${sqlUuid(workflowId)};
    `)).toBe('3');

    await resetWorkflowsState();

    expect(selectScalar(`
      SELECT COUNT(*)
        FROM public.workflows
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND COALESCE(name, '') LIKE 'E2E %';
    `)).toBe('0');
    expect(selectScalar(`
      SELECT COUNT(*)
        FROM public.tasks
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND title LIKE 'Orchestrate E2E %';
    `)).toBe('0');
    expect(selectScalar(`
      SELECT COUNT(*)
        FROM public.workspaces
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND slug LIKE 'workflows-%';
    `)).toBe('0');
    expect(selectScalar(`
      SELECT COUNT(*)
        FROM public.playbooks
       WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
         AND (
           slug LIKE 'planned-workflows-%'
           OR slug LIKE 'ongoing-workflows-%'
         );
    `)).toBe('0');
  });
});

function buildFixtureSql(): string {
  return `
    INSERT INTO public.workspaces (
      id,
      tenant_id,
      name,
      slug,
      description,
      created_at,
      updated_at
    ) VALUES (
      ${sqlUuid(WORKSPACE_ID)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlText('E2E Workflow Perf Workspace reset')},
      ${sqlText('workflows-perf-reset')},
      ${sqlText('Fixture workspace for reset regression coverage.')},
      ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz,
      ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz
    );

    INSERT INTO public.playbooks (
      id,
      tenant_id,
      name,
      slug,
      description,
      outcome,
      lifecycle,
      definition,
      created_at,
      updated_at
    ) VALUES
    (
      ${sqlUuid(PLANNED_PLAYBOOK_ID)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlText('E2E Workflow Perf Planned reset')},
      ${sqlText('planned-workflows-perf-reset')},
      ${sqlText('Fixture planned playbook for reset regression coverage.')},
      ${sqlText('Ship the requested outcome')},
      'planned',
      ${sqlText(JSON.stringify({ roles: ['reviewer'] }))}::jsonb,
      ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz,
      ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz
    ),
    (
      ${sqlUuid(ONGOING_PLAYBOOK_ID)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlText('E2E Workflow Perf Ongoing reset')},
      ${sqlText('ongoing-workflows-perf-reset')},
      ${sqlText('Fixture ongoing playbook for reset regression coverage.')},
      ${sqlText('Ship the requested outcome')},
      'ongoing',
      ${sqlText(JSON.stringify({ roles: ['intake-analyst'] }))}::jsonb,
      ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz,
      ${sqlText('2026-02-01T00:00:00.000Z')}::timestamptz
    );

    ${buildWorkflowLoadSeedSql({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: WORKSPACE_ID,
      workspaceName: 'E2E Workflow Perf Workspace reset',
      plannedPlaybookId: PLANNED_PLAYBOOK_ID,
      plannedPlaybookName: 'E2E Workflow Perf Planned reset',
      ongoingPlaybookId: ONGOING_PLAYBOOK_ID,
      ongoingPlaybookName: 'E2E Workflow Perf Ongoing reset',
      count: 1,
      lifecycleMode: 'ongoing',
      turnsPerWorkflow: 1,
      briefsPerWorkflow: 1,
      workItemsPerWorkflow: 1,
      tasksPerWorkflow: 1,
      deliverablesPerWorkflow: 1,
      baseIso: '2026-02-01T00:00:00.000Z',
    })}
  `;
}

function selectScalar(sql: string): string {
  return runPsql(sql).trim();
}
