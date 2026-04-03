import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ID,
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

  describe('updateDefault', () => {
    it('updates a runtime default', async () => {
      const updated = { ...sampleDefault, config_value: '5' };
      ctx.pool.query
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: '5',
      });
      expect(result.config_value).toBe('5');
    });

    it('does not request runtime drain or rollout events after update', async () => {
      const updated = { ...sampleDefault, config_value: '5' };
      ctx.pool.query
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      await ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: '5',
      });

      expect(ctx.fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(ctx.eventService.emit).not.toHaveBeenCalled();
    });

    it('returns current default when no fields to update', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      const result = await ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, {});
      expect(result).toEqual(sampleDefault);
    });

    it('does not drain runtimes for a no-op update', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, {});

      expect(ctx.fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(ctx.eventService.emit).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when default not found', async () => {
      ctx.pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '10' }),
      ).rejects.toThrow('Runtime default not found');
    });

    it('rejects invalid runtime safeguard updates', async () => {
      ctx.pool.query.mockResolvedValueOnce({
        rows: [
          {
            ...sampleDefault,
            config_key: 'agent.max_iterations',
            config_value: '25',
            config_type: 'number',
          },
        ],
        rowCount: 1,
      });

      await expect(
        ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '0' }),
      ).rejects.toThrow('agent.max_iterations must be at least 1');
    });

    it('rejects invalid reactive burst safeguard updates', async () => {
      ctx.pool.query.mockResolvedValueOnce({
        rows: [
          {
            ...sampleDefault,
            config_key: 'agent.max_parallel_tool_calls_per_burst',
            config_value: '4',
            config_type: 'number',
          },
        ],
        rowCount: 1,
      });

      await expect(
        ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '0' }),
      ).rejects.toThrow('agent.max_parallel_tool_calls_per_burst must be at least 1');
    });

    it('redacts secret refs from update responses for secret-bearing defaults', async () => {
      ctx.pool.query
        .mockResolvedValueOnce({
          rows: [{ ...sampleSecretDefault, config_value: 'secret:SERPER_API_KEY' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ ...sampleSecretDefault, config_value: 'secret:TAVILY_API_KEY' }],
          rowCount: 1,
        });

      const result = await ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: 'secret:TAVILY_API_KEY',
      });

      expect(result.config_value).toBe('redacted://runtime-default-secret');
    });

    it('accepts supported orchestrator loop mode values', async () => {
      const current = {
        ...sampleDefault,
        config_key: 'agent.orchestrator_loop_mode',
        config_value: 'tpaov',
        config_type: 'string',
      };
      const updated = { ...current, config_value: 'reactive' };
      ctx.pool.query
        .mockResolvedValueOnce({ rows: [current], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: 'reactive',
      });

      expect(result.config_value).toBe('reactive');
    });

    it('rejects unsupported orchestrator loop mode values', async () => {
      ctx.pool.query.mockResolvedValueOnce({
        rows: [{
          ...sampleDefault,
          config_key: 'agent.orchestrator_loop_mode',
          config_value: 'reactive',
          config_type: 'string',
        }],
        rowCount: 1,
      });

      await expect(
        ctx.service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: 'invalid-mode' }),
      ).rejects.toThrow('agent.orchestrator_loop_mode must be one of: reactive, tpaov');
    });
  });
});
