import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RuntimeDefaultsService } from '../../src/services/runtime-defaults-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ID = '00000000-0000-0000-0000-000000000030';

const sampleDefault = {
  id: DEFAULT_ID,
  tenant_id: TENANT_ID,
  config_key: 'max_rework_attempts',
  config_value: '3',
  config_type: 'number',
  description: 'Maximum rework attempts',
  created_at: new Date(),
  updated_at: new Date(),
};

const sampleSecretDefault = {
  ...sampleDefault,
  config_key: 'tools.web_search_api_key_secret_ref',
  config_value: 'legacy-plaintext-secret',
  config_type: 'string',
  description: 'Web search API key secret ref',
};

describe('RuntimeDefaultsService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RuntimeDefaultsService;

  beforeEach(() => {
    pool = createMockPool();
    service = new RuntimeDefaultsService(pool as never);
  });

  describe('listDefaults', () => {
    it('returns all defaults for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await service.listDefaults(TENANT_ID);
      expect(result).toEqual([sampleDefault]);
    });

    it('redacts secret-bearing runtime defaults on list reads', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

      const result = await service.listDefaults(TENANT_ID);

      expect(result).toEqual([
        {
          ...sampleSecretDefault,
          config_value: 'redacted://runtime-default-secret',
        },
      ]);
    });
  });

  describe('getDefault', () => {
    it('returns a default by id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await service.getDefault(TENANT_ID, DEFAULT_ID);
      expect(result).toEqual(sampleDefault);
    });

    it('throws NotFoundError when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.getDefault(TENANT_ID, DEFAULT_ID)).rejects.toThrow('Runtime default not found');
    });

    it('redacts secret-bearing runtime defaults on single reads', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

      const result = await service.getDefault(TENANT_ID, DEFAULT_ID);

      expect(result).toEqual({
        ...sampleSecretDefault,
        config_value: 'redacted://runtime-default-secret',
      });
    });
  });

  describe('getByKey', () => {
    it('returns default by config key', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await service.getByKey(TENANT_ID, 'max_rework_attempts');
      expect(result).toEqual(sampleDefault);
    });

    it('returns null when key not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await service.getByKey(TENANT_ID, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('createDefault', () => {
    it('creates a new runtime default', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // getByKey
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 }); // INSERT

      const result = await service.createDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });
      expect(result).toEqual(sampleDefault);
    });

    it('throws ConflictError when key already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'max_rework_attempts',
          configValue: '5',
          configType: 'number',
        }),
      ).rejects.toThrow('already exists');
    });

    it('rejects invalid config type', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'test',
          configValue: 'val',
          configType: 'invalid' as 'string',
        }),
      ).rejects.toThrow();
    });

    it('rejects empty config key', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: '',
          configValue: 'val',
          configType: 'string',
        }),
      ).rejects.toThrow();
    });

    it('redacts secret refs from create responses for secret-bearing defaults', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ ...sampleSecretDefault, config_value: 'secret:SERPER_API_KEY' }],
          rowCount: 1,
        });

      const result = await service.createDefault(TENANT_ID, {
        configKey: 'tools.web_search_api_key_secret_ref',
        configValue: 'secret:SERPER_API_KEY',
        configType: 'string',
      });

      expect(result.config_value).toBe('redacted://runtime-default-secret');
    });

    it('rejects invalid runtime agent count defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'agent.history_max_messages',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('agent.history_max_messages must be at least 1');
    });

    it('rejects out-of-range runtime compaction defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'agent.context_compaction_threshold',
          configValue: '1.4',
          configType: 'number',
        }),
      ).rejects.toThrow('agent.context_compaction_threshold must be between 0 and 1');
    });

    it('rejects non-positive runtime timeout defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'workspace.clone_timeout_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('workspace.clone_timeout_seconds must be at least 1');
    });

    it('rejects non-positive connected runtime timeout defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.claim_poll_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.claim_poll_seconds must be at least 1');
    });

    it('rejects non-positive task timeout defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'tasks.default_timeout_minutes',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('tasks.default_timeout_minutes must be at least 1');
    });

    it('rejects non-positive container manager defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container_manager.reconcile_interval_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('container_manager.reconcile_interval_seconds must be at least 1');
    });

    it('rejects invalid worker supervision defaults', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.worker_dispatch_ack_timeout_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.worker_dispatch_ack_timeout_ms must be at least 1');

      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.worker_offline_threshold_multiplier',
          configValue: '0.5',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.worker_offline_threshold_multiplier must be at least 1');
    });
  });

  describe('updateDefault', () => {
    it('updates a runtime default', async () => {
      const updated = { ...sampleDefault, config_value: '5' };
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: '5',
      });
      expect(result.config_value).toBe('5');
    });

    it('returns current default when no fields to update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      const result = await service.updateDefault(TENANT_ID, DEFAULT_ID, {});
      expect(result).toEqual(sampleDefault);
    });

    it('throws NotFoundError when default not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '10' }),
      ).rejects.toThrow('Runtime default not found');
    });

    it('rejects invalid runtime safeguard updates', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ ...sampleDefault, config_key: 'agent.max_iterations', config_value: '25', config_type: 'number' }],
        rowCount: 1,
      });

      await expect(
        service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '0' }),
      ).rejects.toThrow('agent.max_iterations must be at least 1');
    });

    it('redacts secret refs from update responses for secret-bearing defaults', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ ...sampleSecretDefault, config_value: 'secret:SERPER_API_KEY' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ ...sampleSecretDefault, config_value: 'secret:TAVILY_API_KEY' }],
          rowCount: 1,
        });

      const result = await service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: 'secret:TAVILY_API_KEY',
      });

      expect(result.config_value).toBe('redacted://runtime-default-secret');
    });
  });

  describe('upsertDefault', () => {
    it('inserts or updates via ON CONFLICT', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      const result = await service.upsertDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });
      expect(result).toEqual(sampleDefault);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT');
    });
  });

  describe('deleteDefault', () => {
    it('deletes a runtime default', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await expect(service.deleteDefault(TENANT_ID, DEFAULT_ID)).resolves.toBeUndefined();
    });

    it('throws NotFoundError when default not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.deleteDefault(TENANT_ID, DEFAULT_ID)).rejects.toThrow('Runtime default not found');
    });
  });
});
