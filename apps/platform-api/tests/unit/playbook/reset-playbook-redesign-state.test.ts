import { describe, expect, it, vi } from 'vitest';

import { resetPlaybookRedesignState } from '../../../src/bootstrap/seed.js';

describe('resetPlaybookRedesignState', () => {
  it('truncates redesign-owned tables while preserving admin key and llm configuration tables', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { tablename: 'api_keys' },
            { tablename: 'llm_providers' },
            { tablename: 'llm_models' },
            { tablename: 'role_model_assignments' },
            { tablename: 'runtime_defaults' },
            { tablename: 'tenants' },
            { tablename: 'schema_migrations' },
            { tablename: 'playbooks' },
            { tablename: 'workspaces' },
            { tablename: 'workflow_work_items' },
            { tablename: 'platform_instructions' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await resetPlaybookRedesignState(pool as never);

    expect(pool.query).toHaveBeenCalledTimes(4);
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('DELETE FROM api_keys'),
      [expect.any(String), expect.any(String)],
    );
    const sql = String(pool.query.mock.calls[2]?.[0] ?? '');
    expect(sql).toContain('TRUNCATE TABLE');
    expect(sql).toContain('"public"."playbooks"');
    expect(sql).toContain('"public"."workspaces"');
    expect(sql).toContain('"public"."workflow_work_items"');
    expect(sql).toContain('"public"."platform_instructions"');
    expect(sql).not.toContain('"public"."api_keys"');
    expect(sql).not.toContain('"public"."llm_providers"');
    expect(sql).not.toContain('"public"."llm_models"');
    expect(sql).not.toContain('"public"."role_model_assignments"');
    expect(sql).not.toContain('"public"."runtime_defaults"');
    expect(sql).not.toContain('"public"."tenants"');
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('DELETE FROM runtime_defaults'),
      [expect.any(String), ['default_model_id', 'default_reasoning_config']],
    );
  });

  it('does nothing when only preserved tables exist', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { tablename: 'api_keys' },
            { tablename: 'llm_providers' },
            { tablename: 'llm_models' },
            { tablename: 'role_model_assignments' },
            { tablename: 'runtime_defaults' },
            { tablename: 'tenants' },
            { tablename: 'schema_migrations' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await resetPlaybookRedesignState(pool as never);

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('DELETE FROM runtime_defaults'),
      [expect.any(String), ['default_model_id', 'default_reasoning_config']],
    );
  });
});
