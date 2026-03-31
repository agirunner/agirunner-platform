import { describe, expect, it } from 'vitest';

import {
  buildBulkWorkflowHeartbeatGuardInsertSql,
  buildBulkWorkflowInsertSql,
} from './workflows-bulk-seed.js';

describe('buildBulkWorkflowInsertSql', () => {
  it('returns empty SQL when the requested bulk count is zero', () => {
    expect(
      buildBulkWorkflowInsertSql({
        tenantId: 'tenant',
        workspaceId: 'workspace',
        playbookId: 'playbook',
        count: 0,
      }),
    ).toBe('');
  });

  it('builds insert rows with descending timestamps for the requested workflow count', () => {
    const sql = buildBulkWorkflowInsertSql({
      tenantId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000010',
      playbookId: '00000000-0000-0000-0000-000000000020',
      count: 2,
      baseIso: '2026-01-01T00:00:00.000Z',
    });

    expect(sql).toContain('E2E Bulk Workflow 0000');
    expect(sql).toContain('E2E Bulk Workflow 0001');
    expect(sql).toContain('2026-01-01T00:00:02.000Z');
    expect(sql).toContain('2026-01-01T00:00:01.000Z');
    expect(sql).toContain("'completed'::public.workflow_state");
    expect(sql).toContain("'cancelled'::public.workflow_state");
  });

  it('builds heartbeat guard task inserts for ongoing bulk workflows', () => {
    const sql = buildBulkWorkflowHeartbeatGuardInsertSql({
      tenantId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000010',
      playbookId: '00000000-0000-0000-0000-000000000020',
      count: 3,
      lifecycle: 'ongoing',
      namePrefix: 'E2E Bulk Ongoing Workflow',
    });

    expect(sql).toContain('INSERT INTO public.tasks');
    expect(sql).toContain("'Seed heartbeat guard'");
    expect(sql).toContain("'seed-guard'");
    expect(sql).toContain(`'E2E Bulk Ongoing Workflow %'`);
    expect(sql).toContain(`t.metadata->>'seeded_heartbeat_guard' = 'true'`);
  });

  it('skips heartbeat guard SQL for planned bulk workflows', () => {
    expect(
      buildBulkWorkflowHeartbeatGuardInsertSql({
        tenantId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000010',
        playbookId: '00000000-0000-0000-0000-000000000020',
        count: 3,
        lifecycle: 'planned',
        namePrefix: 'E2E Bulk Workflow',
      }),
    ).toBe('');
  });
});
