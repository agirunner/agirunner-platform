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
  verification_strategy: 'peer_review',
  execution_container_config: null,
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
        verificationStrategy: 'peer_review',
        isActive: true,
      });

      expect(result).toEqual(sampleRole);
    });

    it('persists execution container overrides', async () => {
      const inserted = {
        ...sampleRole,
        execution_container_config: {
          image: 'agirunner-runtime-execution:role',
          cpu: '2',
          memory: '2Gi',
          pull_policy: 'never',
        },
      };
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [inserted], rowCount: 1 });

      const result = await service.createRole(TENANT_ID, {
        name: 'developer',
        allowedTools: [],
        executionContainerConfig: {
          image: 'agirunner-runtime-execution:role',
          cpu: '2',
          memory: '2Gi',
          pullPolicy: 'never',
        },
      });

      expect(result.execution_container_config).toEqual(inserted.execution_container_config);
      expect(pool.query.mock.calls[1]?.[1]).toContainEqual(inserted.execution_container_config);
    });

    it('defaults execution container pull policy to if-not-present when omitted', async () => {
      const inserted = {
        ...sampleRole,
        execution_container_config: {
          image: 'agirunner-runtime-execution:role',
          cpu: '2',
          memory: '2Gi',
          pull_policy: 'if-not-present',
        },
      };
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [inserted], rowCount: 1 });

      const result = await service.createRole(TENANT_ID, {
        name: 'developer',
        allowedTools: [],
        executionContainerConfig: {
          image: 'agirunner-runtime-execution:role',
          cpu: '2',
          memory: '2Gi',
        },
      });

      expect(result.execution_container_config).toEqual(inserted.execution_container_config);
      expect(pool.query.mock.calls[1]?.[1]).toContainEqual(inserted.execution_container_config);
    });

    it('throws ConflictError when role name already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });

      await expect(
        service.createRole(TENANT_ID, {
          name: 'developer',
          allowedTools: [],
          isActive: true,
        }),
      ).rejects.toThrow('already exists');
    });

    it('rejects invalid input', async () => {
      await expect(
        service.createRole(TENANT_ID, { name: '', allowedTools: [], isActive: true }),
      ).rejects.toThrow();
    });

    it('rejects legacy capabilities input', async () => {
      await expect(
        service.createRole(TENANT_ID, {
          name: 'developer',
          allowedTools: [],
          capabilities: ['coding'],
          isActive: true,
        } as never),
      ).rejects.toThrow();
    });

    it('rejects invalid execution container overrides', async () => {
      await expect(
        service.createRole(TENANT_ID, {
          name: 'developer',
          allowedTools: [],
          executionContainerConfig: {
            image: 'https://ghcr.io/agirunner/runtime latest',
            cpu: 'zero',
            memory: 'banana',
          },
        }),
      ).rejects.toThrow('valid container image reference');
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

    it('updates execution container overrides', async () => {
      const updated = {
        ...sampleRole,
        execution_container_config: {
          image: 'agirunner-runtime-execution:override',
          cpu: '4',
          memory: '4Gi',
          pull_policy: 'always',
        },
      };
      pool.query
        .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {
        executionContainerConfig: {
          image: 'agirunner-runtime-execution:override',
          cpu: '4',
          memory: '4Gi',
          pullPolicy: 'always',
        },
      });

      expect(result.execution_container_config).toEqual(updated.execution_container_config);
      expect(pool.query.mock.calls[1]?.[1]).toContainEqual(updated.execution_container_config);
    });

    it('returns current role when no fields to update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {});
      expect(result).toEqual(sampleRole);
    });
  });

  describe('secret redaction', () => {
    const REDACTED = 'redacted://role-definition-secret';

    it('redacts secret references in system_prompt via listRoles', async () => {
      const roleWithSecrets = {
        ...sampleRole,
        system_prompt: 'secret:provider-api-key-openai',
      };
      pool.query.mockResolvedValueOnce({ rows: [roleWithSecrets], rowCount: 1 });

      const result = await service.listRoles(TENANT_ID);

      expect(result[0].system_prompt).toBe(REDACTED);
    });

    it('redacts secret references in system_prompt via getRoleById', async () => {
      const roleWithSecret = {
        ...sampleRole,
        system_prompt: 'secret:github-token-prod',
      };
      pool.query.mockResolvedValueOnce({ rows: [roleWithSecret], rowCount: 1 });

      const result = await service.getRoleById(TENANT_ID, ROLE_ID);

      expect(result.system_prompt).toBe(REDACTED);
    });

    it('redacts secret references in system_prompt via getRoleByName', async () => {
      const roleWithSecrets = {
        ...sampleRole,
        system_prompt: 'secret:my-db-password',
      };
      pool.query.mockResolvedValueOnce({ rows: [roleWithSecrets], rowCount: 1 });

      const result = await service.getRoleByName(TENANT_ID, 'developer');

      expect(result!.system_prompt).toBe(REDACTED);
    });

    it('redacts secret references in system_prompt via createRole', async () => {
      const insertedRow = {
        ...sampleRole,
        system_prompt: 'secret:openai-key',
      };
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [insertedRow], rowCount: 1 });

      const result = await service.createRole(TENANT_ID, {
        name: 'developer',
        systemPrompt: 'secret:openai-key',
        allowedTools: [],
      });

      expect(result.system_prompt).toBe(REDACTED);
    });

    it('redacts secret references in system_prompt via updateRole', async () => {
      const updatedRow = {
        ...sampleRole,
        system_prompt: 'secret:github-token-prod',
      };
      pool.query
        .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {
        systemPrompt: 'secret:github-token-prod',
      });

      expect(result.system_prompt).toBe(REDACTED);
    });

    it('preserves non-secret system_prompt content unchanged', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 });

      const result = await service.getRoleById(TENANT_ID, ROLE_ID);

      expect(result.system_prompt).toBe('You are a developer.');
      expect(result.name).toBe('developer');
      expect(result.description).toBe('Implements features');
    });

    it('redacts enc:v1 encrypted values in description field', async () => {
      const roleWithEncrypted = {
        ...sampleRole,
        description: 'enc:v1:ciphertext-data-here',
      };
      pool.query.mockResolvedValueOnce({ rows: [roleWithEncrypted], rowCount: 1 });

      const result = await service.getRoleById(TENANT_ID, ROLE_ID);

      expect(result.description).toBe(REDACTED);
    });

    it('redacts secret references in model_preference field', async () => {
      const roleWithSecretModel = {
        ...sampleRole,
        model_preference: 'secret:custom-model-key',
      };
      pool.query.mockResolvedValueOnce({ rows: [roleWithSecretModel], rowCount: 1 });

      const result = await service.getRoleById(TENANT_ID, ROLE_ID);

      expect(result.model_preference).toBe(REDACTED);
    });

    it('preserves Date fields through sanitization', async () => {
      const now = new Date();
      const roleWithDates = { ...sampleRole, created_at: now, updated_at: now };
      pool.query.mockResolvedValueOnce({ rows: [roleWithDates], rowCount: 1 });

      const result = await service.getRoleById(TENANT_ID, ROLE_ID);

      expect(result.created_at).toEqual(now);
      expect(result.updated_at).toEqual(now);
    });

    it('does not expose legacy fallback_model in sanitized role responses', async () => {
      const roleWithFallback = { ...sampleRole, fallback_model: 'gpt-4.1' };
      pool.query.mockResolvedValueOnce({ rows: [roleWithFallback], rowCount: 1 });

      const result = await service.getRoleById(TENANT_ID, ROLE_ID);

      expect(result).not.toHaveProperty('fallback_model');
    });
  });

  describe('deleteRole', () => {
    it('deletes a role not used by any playbook', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }) // getRoleById
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // findPlaybooksUsingRole
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // findWorkflowReferencedPlaybooksUsingRole
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE role_model_assignments
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

      await expect(service.deleteRole(TENANT_ID, ROLE_ID)).resolves.toBeUndefined();
      expect(pool.query).toHaveBeenNthCalledWith(
        4,
        'DELETE FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
        [TENANT_ID, sampleRole.name],
      );
    });

    it('rejectsDeleteWhenRoleIsUsedByPlaybook', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }) // getRoleById
        .mockResolvedValueOnce({ rows: [{ name: 'SDLC' }], rowCount: 1 }); // findPlaybooksUsingRole

      await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow('used by playbook');
    });

    it('rejects delete when a workflow-linked inactive playbook version still uses the role', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleRole], rowCount: 1 }) // getRoleById
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // active playbooks
        .mockResolvedValueOnce({ rows: [{ name: 'SDLC v4' }], rowCount: 1 }); // workflow-linked playbooks

      await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow('referenced by workflow');
    });

    it('throws NotFoundError when role does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow('Role definition not found');
    });
  });
});
