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
  });

  describe('updateDefault', () => {
    it('updates a runtime default', async () => {
      const updated = { ...sampleDefault, config_value: '5' };
      pool.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

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
