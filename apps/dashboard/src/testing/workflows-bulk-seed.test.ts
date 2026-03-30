import { describe, expect, it } from 'vitest';

import { buildBulkWorkflowInsertSql } from './workflows-bulk-seed.js';

describe('buildBulkWorkflowInsertSql', () => {
  it('builds deterministic bulk workflow rows without using the workflows API', () => {
    const sql = buildBulkWorkflowInsertSql({
      tenantId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      playbookId: '00000000-0000-0000-0000-000000000003',
      count: 3,
      baseIso: '2026-01-01T00:00:00.000Z',
    });

    expect(sql).toContain('INSERT INTO public.workflows');
    expect(sql).toContain('E2E Bulk Workflow 0000');
    expect(sql).toContain('E2E Bulk Workflow 0001');
    expect(sql).toContain('E2E Bulk Workflow 0002');
    expect(sql).toContain("'pending'::public.workflow_state");
    expect(sql).toContain("'planned'");
    expect(sql).toContain("'2026-01-01T00:00:03.000Z'::timestamptz");
    expect(sql).toContain("'2026-01-01T00:00:02.000Z'::timestamptz");
    expect(sql).toContain("'2026-01-01T00:00:01.000Z'::timestamptz");
  });

  it('returns empty SQL for an empty bulk seed request', () => {
    expect(
      buildBulkWorkflowInsertSql({
        tenantId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000002',
        playbookId: '00000000-0000-0000-0000-000000000003',
        count: 0,
      }),
    ).toBe('');
  });
});
