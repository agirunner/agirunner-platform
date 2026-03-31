import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ID,
  TENANT_ID,
  createRuntimeDefaultsTestContext,
  sampleCharsPerTokenDefault,
  sampleDefault,
  sampleSecretDefault,
  sampleVaultTimeoutDefault,
} from './shared.js';

describe('RuntimeDefaultsService', () => {
  let ctx: ReturnType<typeof createRuntimeDefaultsTestContext>;

  beforeEach(() => {
    ctx = createRuntimeDefaultsTestContext();
  });

  describe('listDefaults', () => {
    it('returns all defaults for tenant', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await ctx.service.listDefaults(TENANT_ID);
      expect(result).toEqual([sampleDefault]);
    });

    it('redacts secret-bearing runtime defaults on list reads', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

      const result = await ctx.service.listDefaults(TENANT_ID);

      expect(result).toEqual([
        {
          ...sampleSecretDefault,
          config_value: 'redacted://runtime-default-secret',
        },
      ]);
    });

    it('does not redact non-secret numeric defaults whose keys contain token or secrets substrings', async () => {
      ctx.pool.query.mockResolvedValueOnce({
        rows: [sampleCharsPerTokenDefault, sampleVaultTimeoutDefault],
        rowCount: 2,
      });

      const result = await ctx.service.listDefaults(TENANT_ID);

      expect(result).toEqual([sampleCharsPerTokenDefault, sampleVaultTimeoutDefault]);
    });
  });

  describe('getDefault', () => {
    it('returns a default by id', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await ctx.service.getDefault(TENANT_ID, DEFAULT_ID);
      expect(result).toEqual(sampleDefault);
    });

    it('throws NotFoundError when not found', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(ctx.service.getDefault(TENANT_ID, DEFAULT_ID)).rejects.toThrow(
        'Runtime default not found',
      );
    });

    it('redacts secret-bearing runtime defaults on single reads', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

      const result = await ctx.service.getDefault(TENANT_ID, DEFAULT_ID);

      expect(result).toEqual({
        ...sampleSecretDefault,
        config_value: 'redacted://runtime-default-secret',
      });
    });

    it('does not redact non-secret numeric defaults on single reads', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleCharsPerTokenDefault], rowCount: 1 });

      const result = await ctx.service.getDefault(TENANT_ID, DEFAULT_ID);

      expect(result).toEqual(sampleCharsPerTokenDefault);
    });
  });

  describe('getByKey', () => {
    it('returns default by config key', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await ctx.service.getByKey(TENANT_ID, 'max_rework_attempts');
      expect(result).toEqual(sampleDefault);
    });

    it('returns null when key not found', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await ctx.service.getByKey(TENANT_ID, 'nonexistent');
      expect(result).toBeNull();
    });
  });
});
