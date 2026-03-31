import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ID,
  TENANT_ID,
  createRuntimeDefaultsTestContext,
  sampleDefault,
} from './shared.js';

describe('RuntimeDefaultsService', () => {
  let ctx: ReturnType<typeof createRuntimeDefaultsTestContext>;

  beforeEach(() => {
    ctx = createRuntimeDefaultsTestContext();
  });

  describe('upsertDefault', () => {
    it('inserts or updates via ON CONFLICT', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      const result = await ctx.service.upsertDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });
      expect(result).toEqual(sampleDefault);
      const sql = ctx.pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT');
    });

    it('does not request runtime drain or rollout events after upsert', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await ctx.service.upsertDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });

      expect(ctx.fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(ctx.eventService.emit).not.toHaveBeenCalled();
    });

    it('rejects upserts for deprecated legacy specialist runtime target defaults', async () => {
      await expect(
        ctx.service.upsertDefault(TENANT_ID, {
          configKey: 'default_pull_policy',
          configValue: 'always',
          configType: 'string',
        }),
      ).rejects.toThrow('default_pull_policy has been removed');

      expect(ctx.pool.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteDefault', () => {
    it('deletes a runtime default', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await expect(
        ctx.service.deleteDefault(TENANT_ID, DEFAULT_ID, 'max_rework_attempts'),
      ).resolves.toBeUndefined();
    });

    it('does not request runtime drain or rollout events after delete', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await ctx.service.deleteDefault(TENANT_ID, DEFAULT_ID, 'max_rework_attempts');

      expect(ctx.fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(ctx.eventService.emit).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when default not found', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(
        ctx.service.deleteDefault(TENANT_ID, DEFAULT_ID, 'max_rework_attempts'),
      ).rejects.toThrow('Runtime default not found');
    });

    it('rejects deleting required specialist runtime defaults', async () => {
      await expect(
        ctx.service.deleteDefault(TENANT_ID, DEFAULT_ID, 'specialist_runtime_default_memory'),
      ).rejects.toThrow(
        'Runtime default "specialist_runtime_default_memory" is required and cannot be deleted',
      );
      expect(ctx.pool.query).not.toHaveBeenCalled();
    });
  });
});
