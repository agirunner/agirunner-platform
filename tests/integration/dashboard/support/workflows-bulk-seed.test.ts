import { describe, expect, it } from 'vitest';

import { buildBulkWorkflowInsertSql } from './workflows-bulk-seed.js';

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
  });
});
