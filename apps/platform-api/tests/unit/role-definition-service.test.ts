import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RoleDefinitionService } from '../../src/services/role-definition-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ROLE_ID = '00000000-0000-0000-0000-000000000099';

const sampleRole = {
  id: ROLE_ID,
  tenant_id: TENANT_ID,
  name: 'developer',
  description: 'Implements features',
  system_prompt: 'You are a developer.',
  allowed_tools: ['file_read', 'file_write'],
  model_preference: 'gpt-5-mini',
  fallback_model: null,
  verification_strategy: 'unit_tests',
  capabilities: ['llm-api', 'role:developer'],
  is_built_in: true,
  is_active: true,
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('RoleDefinitionService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RoleDefinitionService;

  beforeEach(() => {
    pool = createMockPool();
    service = new RoleDefinitionService(pool as never);
  });

  describe('listRoles', () => {
    it('returns all roles for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });
      const result = await service.listRoles(TENANT_ID);
      expect(result).toEqual([sampleRole]);
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it('filters active roles when activeOnly is true', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });
      const result = await service.listRoles(TENANT_ID, true);
      expect(result).toEqual([sampleRole]);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('is_active');
    });
  });

  describe('getRoleByName', () => {
    it('returns role when found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });
      const result = await service.getRoleByName(TENANT_ID, 'developer');
      expect(result).toEqual(sampleRole);
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await service.getRoleByName(TENANT_ID, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getRoleById', () => {
    it('returns role when found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });
      const result = await service.getRoleById(TENANT_ID, ROLE_ID);
      expect(result).toEqual(sampleRole);
    });

    it('throws NotFoundError when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.getRoleById(TENANT_ID, ROLE_ID)).rejects.toThrow('Role definition not found');
    });
  });

  describe('createRole', () => {
    it('creates a new role', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // getRoleByName check
        .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }); // INSERT

      const result = await service.createRole(TENANT_ID, {
        name: 'developer',
        description: 'Implements features',
        systemPrompt: 'You are a developer.',
        allowedTools: ['file_read', 'file_write'],
        modelPreference: 'gpt-5-mini',
        verificationStrategy: 'unit_tests',
        capabilities: ['llm-api', 'role:developer'],
        isBuiltIn: true,
        isActive: true,
      });

      expect(result).toEqual(sampleRole);
    });

    it('throws ConflictError when role name already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });

      await expect(
        service.createRole(TENANT_ID, {
          name: 'developer',
          allowedTools: [],
          capabilities: [],
          isBuiltIn: false,
          isActive: true,
        }),
      ).rejects.toThrow('already exists');
    });

    it('rejects invalid input', async () => {
      await expect(
        service.createRole(TENANT_ID, { name: '', allowedTools: [], capabilities: [], isBuiltIn: false, isActive: true }),
      ).rejects.toThrow();
    });
  });

  describe('updateRole', () => {
    it('updates a role', async () => {
      const updated = { ...sampleRole, description: 'Updated' };
      pool.query
        .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }) // getRoleById
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 }); // UPDATE

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {
        description: 'Updated',
      });

      expect(result.description).toBe('Updated');
    });

    it('returns current role when no fields to update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {});
      expect(result).toEqual(sampleRole);
    });
  });

  describe('deleteRole', () => {
    it('deletes a non-built-in role', async () => {
      const nonBuiltIn = { ...sampleRole, is_built_in: false };
      pool.query
        .mockResolvedValueOnce({ rows: [nonBuiltIn], rowCount: 1 }) // getRoleById
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

      await expect(service.deleteRole(TENANT_ID, ROLE_ID)).resolves.toBeUndefined();
    });

    it('throws ConflictError when deleting built-in role', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });

      await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow('Cannot delete built-in role');
    });

    it('throws NotFoundError when role does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow('Role definition not found');
    });
  });
});
