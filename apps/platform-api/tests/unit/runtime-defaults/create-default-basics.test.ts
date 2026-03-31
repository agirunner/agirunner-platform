import { beforeEach, describe, expect, it } from 'vitest';

import {
  TENANT_ID,
  createRuntimeDefaultsTestContext,
  sampleDefault,
  sampleSecretDefault,
} from './shared.js';

describe('RuntimeDefaultsService', () => {
  let ctx: ReturnType<typeof createRuntimeDefaultsTestContext>;

  beforeEach(() => {
    ctx = createRuntimeDefaultsTestContext();
  });

  describe('createDefault', () => {
    it('creates a new runtime default', async () => {
      ctx.pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      const result = await ctx.service.createDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });
      expect(result).toEqual(sampleDefault);
    });

    it('does not request runtime drain or rollout events after create', async () => {
      ctx.pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await ctx.service.createDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });

      expect(ctx.fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(ctx.eventService.emit).not.toHaveBeenCalled();
    });

    it('throws ConflictError when key already exists', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await expect(
        ctx.service.createDefault(TENANT_ID, {
          configKey: 'max_rework_attempts',
          configValue: '5',
          configType: 'number',
        }),
      ).rejects.toThrow('already exists');
    });

    it('rejects invalid config type', async () => {
      await expect(
        ctx.service.createDefault(TENANT_ID, {
          configKey: 'test',
          configValue: 'val',
          configType: 'invalid' as 'string',
        }),
      ).rejects.toThrow();
    });

    it('rejects empty config key', async () => {
      await expect(
        ctx.service.createDefault(TENANT_ID, {
          configKey: '',
          configValue: 'val',
          configType: 'string',
        }),
      ).rejects.toThrow();
    });

    it('redacts secret refs from create responses for secret-bearing defaults', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
        rows: [{ ...sampleSecretDefault, config_value: 'secret:SERPER_API_KEY' }],
        rowCount: 1,
      });

      const result = await ctx.service.createDefault(TENANT_ID, {
        configKey: 'custom.api_key_secret_ref',
        configValue: 'secret:SERPER_API_KEY',
        configType: 'string',
      });

      expect(result.config_value).toBe('redacted://runtime-default-secret');
    });
  });
});
