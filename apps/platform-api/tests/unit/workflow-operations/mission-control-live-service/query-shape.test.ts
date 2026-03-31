import { describe, expect, it, vi } from 'vitest';

import {
  countWorkflowRows,
  loadWorkflowRows,
} from '../../../../src/services/workflow-operations/mission-control-live-service/workflow-list-queries.js';

describe('workflow list query shape', () => {
  it('skips needs-action summary CTEs for the default rail query', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const pool = { query };

    await loadWorkflowRows(pool as never, 'tenant-1', {
      page: 1,
      perPage: 25,
      lifecycleFilter: 'all',
      needsActionOnly: false,
    });

    const [sqlArg] = query.mock.calls.at(0) ?? [];
    const sql = String(sqlArg ?? '');

    expect(sql).not.toContain('task_summary AS');
    expect(sql).not.toContain('stage_summary AS');
    expect(sql).not.toContain('work_item_summary AS');
    expect(sql).not.toContain('recovery_summary AS');
    expect(sql).not.toContain('LEFT JOIN task_summary');
    expect(sql).not.toContain('LEFT JOIN stage_summary');
    expect(sql).not.toContain('LEFT JOIN work_item_summary');
    expect(sql).not.toContain('LEFT JOIN recovery_summary');
  });

  it('keeps needs-action summary CTEs when filtering the rail by operator action', async () => {
    const query = vi.fn(async () => ({ rows: [{ total_count: 3 }], rowCount: 1 }));
    const pool = { query };

    await countWorkflowRows(pool as never, 'tenant-1', {
      lifecycleFilter: 'planned',
      needsActionOnly: true,
    });

    const [sqlArg] = query.mock.calls.at(0) ?? [];
    const sql = String(sqlArg ?? '');

    expect(sql).toContain('task_summary AS');
    expect(sql).toContain('stage_summary AS');
    expect(sql).toContain('work_item_summary AS');
    expect(sql).toContain('recovery_summary AS');
    expect(sql).toContain('LEFT JOIN task_summary');
    expect(sql).toContain('LEFT JOIN stage_summary');
    expect(sql).toContain('LEFT JOIN work_item_summary');
    expect(sql).toContain('LEFT JOIN recovery_summary');
  });
});
