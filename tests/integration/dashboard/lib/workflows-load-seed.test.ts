import { describe, expect, it } from 'vitest';

import {
  buildWorkflowLoadSeedPlan,
  buildWorkflowLoadSeedSql,
} from './workflows-load-seed.js';

describe('buildWorkflowLoadSeedSql', () => {
  it('returns empty SQL when the requested workflow count is zero', () => {
    expect(
      buildWorkflowLoadSeedSql({
        tenantId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000002',
        workspaceName: 'Perf Workspace',
        plannedPlaybookId: '00000000-0000-0000-0000-000000000003',
        plannedPlaybookName: 'Planned Perf',
        ongoingPlaybookId: '00000000-0000-0000-0000-000000000004',
        ongoingPlaybookName: 'Ongoing Perf',
        count: 0,
      }),
    ).toBe('');
  });

  it('builds a realistic seeded workflow corpus with related work items, tasks, logs, briefs, and deliverables', () => {
    const sql = buildWorkflowLoadSeedSql({
      tenantId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      workspaceName: 'Perf Workspace',
      plannedPlaybookId: '00000000-0000-0000-0000-000000000003',
      plannedPlaybookName: 'Planned Perf',
      ongoingPlaybookId: '00000000-0000-0000-0000-000000000004',
      ongoingPlaybookName: 'Ongoing Perf',
      count: 7,
      baseIso: '2026-02-01T00:00:00.000Z',
    });

    expect(sql).toContain('INSERT INTO public.workflows');
    expect(sql).toContain('INSERT INTO public.workflow_work_items');
    expect(sql).toContain('INSERT INTO public.tasks');
    expect(sql).toContain('INSERT INTO public.execution_logs');
    expect(sql).toContain('INSERT INTO public.workflow_operator_briefs');
    expect(sql).toContain('INSERT INTO public.workflow_documents');
    expect(sql).toContain("'awaiting_approval'::task_state");
    expect(sql).toContain("'escalated'::task_state");
    expect(sql).toContain("'completed'::public.workflow_state");
    expect(sql).toContain("'cancelled'::public.workflow_state");
    expect(sql).toContain("'failed'::public.workflow_state");
    expect(sql).toContain("'awaiting_approval'");
    expect(sql).toContain("'open'");
    expect(sql).toContain('E2E Perf Workflow 00001');
    expect(sql).toContain('E2E Perf Workflow 00007');
  });

  it('can seed an ongoing-only workflow corpus for rail stress checks', () => {
    const sql = buildWorkflowLoadSeedSql({
      tenantId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      workspaceName: 'Perf Workspace',
      plannedPlaybookId: '00000000-0000-0000-0000-000000000003',
      plannedPlaybookName: 'Planned Perf',
      ongoingPlaybookId: '00000000-0000-0000-0000-000000000004',
      ongoingPlaybookName: 'Ongoing Perf',
      count: 3,
      lifecycleMode: 'ongoing',
      baseIso: '2026-02-01T00:00:00.000Z',
    });

    expect(sql).toContain("'ongoing'");
    expect(sql).not.toContain("'planned'");
    expect(sql).not.toContain("'completed'::public.workflow_state");
    expect(sql).not.toContain("'cancelled'::public.workflow_state");
    expect(sql).toContain('seeded_heartbeat_guard');
  });

  it('builds configurable multi-work-item workflow plans for realistic perf seeding', () => {
    const plan = buildWorkflowLoadSeedPlan({
      tenantId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      workspaceName: 'Perf Workspace',
      plannedPlaybookId: '00000000-0000-0000-0000-000000000003',
      plannedPlaybookName: 'Planned Perf',
      ongoingPlaybookId: '00000000-0000-0000-0000-000000000004',
      ongoingPlaybookName: 'Ongoing Perf',
      count: 1,
      lifecycleMode: 'planned',
      workItemsPerWorkflow: 3,
      tasksPerWorkflow: 5,
      deliverablesPerWorkflow: 4,
      briefsPerWorkflow: 2,
      turnsPerWorkflow: 6,
      baseIso: '2026-02-01T00:00:00.000Z',
    });

    expect(plan.workflows).toHaveLength(1);
    expect(plan.stages).toHaveLength(2);
    expect(plan.workItems).toHaveLength(3);
    expect(plan.tasks).toHaveLength(5);
    expect(plan.logs).toHaveLength(6);
    expect(plan.briefs).toHaveLength(2);
    expect(plan.documents).toHaveLength(4);
  });

  it('keeps seeded row ids unique at larger perf corpus sizes', () => {
    const plan = buildWorkflowLoadSeedPlan({
      tenantId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      workspaceName: 'Perf Workspace',
      plannedPlaybookId: '00000000-0000-0000-0000-000000000003',
      plannedPlaybookName: 'Planned Perf',
      ongoingPlaybookId: '00000000-0000-0000-0000-000000000004',
      ongoingPlaybookName: 'Ongoing Perf',
      count: 50,
      lifecycleMode: 'ongoing',
      workItemsPerWorkflow: 2,
      tasksPerWorkflow: 2,
      deliverablesPerWorkflow: 1,
      briefsPerWorkflow: 1,
      turnsPerWorkflow: 1,
      baseIso: '2026-02-01T00:00:00.000Z',
    });

    const ids = [
      ...extractRowIds(plan.workflows),
      ...extractRowIds(plan.stages),
      ...extractRowIds(plan.workItems),
      ...extractRowIds(plan.tasks),
      ...extractRowIds(plan.briefs),
      ...extractRowIds(plan.documents),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});

function extractRowIds(rows: string[]): string[] {
  return rows
    .map((row) => row.match(/'([0-9a-f-]{36})'::uuid/iu)?.[1] ?? null)
    .filter((value): value is string => value !== null);
}
