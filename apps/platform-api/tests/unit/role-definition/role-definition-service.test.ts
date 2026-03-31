import { beforeEach, describe, expect, it } from 'vitest';

import { RoleDefinitionService } from '../../../src/services/role-definition-service.js';
import {
  buildRoleRow,
  createMockPool,
  ENVIRONMENT_ID,
  MCP_SERVER_ID,
  ROLE_ID,
  SKILL_ID,
  TENANT_ID,
} from './role-definition-test-fixtures.js';

describe('RoleDefinitionService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RoleDefinitionService;

  beforeEach(() => {
    pool = createMockPool();
    service = new RoleDefinitionService(pool as never);
  });

  describe('listRoles', () => {
    it('returns all roles for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 });

      const result = await service.listRoles(TENANT_ID);

      expect(result).toEqual([
        expect.objectContaining({
          id: ROLE_ID,
          name: 'developer',
          execution_environment_id: null,
          execution_environment: null,
          mcp_server_ids: [],
          skill_ids: [],
        }),
      ]);
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it('filters active roles when activeOnly is true', async () => {
      pool.query.mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 });

      await service.listRoles(TENANT_ID, true);

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('rd.is_active = true');
    });
  });

  describe('getRoleByName', () => {
    it('returns role when found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 });

      const result = await service.getRoleByName(TENANT_ID, 'developer');

      expect(result).toEqual(
        expect.objectContaining({
          id: ROLE_ID,
          name: 'developer',
          execution_environment: null,
        }),
      );
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getRoleByName(TENANT_ID, 'nonexistent');

      expect(result).toBeNull();
    });

    it('does not select legacy fallback_model from role_definitions', async () => {
      pool.query.mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 });

      await service.getRoleByName(TENANT_ID, 'developer');

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('rd.*');
      expect(sql).not.toContain('fallback_model');
    });
  });

  describe('getRoleById', () => {
    it('returns role when found', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          buildRoleRow({
            execution_environment_id: ENVIRONMENT_ID,
            mcp_server_ids: [MCP_SERVER_ID],
            skill_ids: [SKILL_ID],
            mcp_servers: [
              {
                id: MCP_SERVER_ID,
                name: 'Docs MCP',
                slug: 'docs-mcp',
                verification_status: 'verified',
                is_archived: false,
              },
            ],
            skills: [
              {
                id: SKILL_ID,
                name: 'Docs Research',
                slug: 'docs-research',
                is_archived: false,
              },
            ],
            ee_id: ENVIRONMENT_ID,
            ee_name: 'Debian Base',
            ee_source_kind: 'catalog',
            ee_catalog_key: 'debian-base',
            ee_catalog_version: 1,
            ee_image: 'debian:trixie-slim',
            ee_cpu: '2',
            ee_memory: '1Gi',
            ee_pull_policy: 'if-not-present',
            ee_compatibility_status: 'compatible',
            ee_verification_contract_version: 'v1',
            ee_verified_metadata: { distro: 'debian' },
            ee_tool_capabilities: { verified_baseline_commands: ['sh'] },
            ee_bootstrap_commands: [],
            ee_bootstrap_required_domains: [],
            ee_catalog_support_status: 'active',
          }),
        ],
        rowCount: 1,
      });

      const result = await service.getRoleById(TENANT_ID, ROLE_ID);

      expect(result.execution_environment_id).toBe(ENVIRONMENT_ID);
      expect(result.mcp_server_ids).toEqual([MCP_SERVER_ID]);
      expect(result.skill_ids).toEqual([SKILL_ID]);
      expect(result.execution_environment).toEqual(
        expect.objectContaining({
          id: ENVIRONMENT_ID,
          name: 'Debian Base',
          image: 'debian:trixie-slim',
        }),
      );
    });

    it('throws NotFoundError when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.getRoleById(TENANT_ID, ROLE_ID)).rejects.toThrow(
        'Role definition not found',
      );
    });
  });

  describe('createRole', () => {
    it('creates a new role', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 });

      const result = await service.createRole(TENANT_ID, {
        name: 'developer',
        description: 'Implements features',
        systemPrompt: 'You are a developer.',
        allowedTools: ['file_read', 'file_write'],
        modelPreference: 'gpt-5-mini',
        verificationStrategy: 'peer_review',
        isActive: true,
      });

      expect(result.name).toBe('developer');
    });

    it('persists mcp grants and ordered skill assignments', async () => {
      pool.query.mockImplementation(async (sql: unknown) => {
        if (typeof sql !== 'string') {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('WHERE rd.tenant_id = $1') && sql.includes('AND rd.name = $2')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM remote_mcp_servers')) {
          return {
            rows: [{
              id: MCP_SERVER_ID,
              is_archived: false,
              verification_status: 'verified',
              already_assigned: false,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM specialist_skills')) {
          return {
            rows: [{
              id: SKILL_ID,
              is_archived: false,
              already_assigned: false,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO role_definitions')) {
          return { rows: [{ id: ROLE_ID }], rowCount: 1 };
        }
        if (sql.includes('WHERE rd.tenant_id = $1') && sql.includes('AND rd.id = $2')) {
          return {
            rows: [
              buildRoleRow({
                mcp_server_ids: [MCP_SERVER_ID],
                skill_ids: [SKILL_ID],
              }),
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      });

      const result = await service.createRole(TENANT_ID, {
        name: 'developer',
        allowedTools: [],
        mcpServerIds: [MCP_SERVER_ID],
        skillIds: [SKILL_ID],
      });

      expect(result.mcp_server_ids).toEqual([MCP_SERVER_ID]);
      expect(result.skill_ids).toEqual([SKILL_ID]);
      expect(
        pool.query.mock.calls.some(
          ([sql]) =>
            typeof sql === 'string' && sql.includes('INSERT INTO specialist_mcp_server_grants'),
        ),
      ).toBe(true);
      expect(
        pool.query.mock.calls.some(
          ([sql]) =>
            typeof sql === 'string' && sql.includes('INSERT INTO specialist_skill_assignments'),
        ),
      ).toBe(true);
    });

    it('persists execution environment references', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: ENVIRONMENT_ID }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [buildRoleRow({ execution_environment_id: ENVIRONMENT_ID })],
          rowCount: 1,
        });

      const result = await service.createRole(TENANT_ID, {
        name: 'developer',
        allowedTools: [],
        executionEnvironmentId: ENVIRONMENT_ID,
      });

      expect(result.execution_environment_id).toBe(ENVIRONMENT_ID);
      expect(pool.query.mock.calls[2]?.[1]).toContain(ENVIRONMENT_ID);
    });

    it('throws ConflictError when role name already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 });

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

    it('rejects non-claimable execution environments', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        service.createRole(TENANT_ID, {
          name: 'developer',
          allowedTools: [],
          executionEnvironmentId: ENVIRONMENT_ID,
        }),
      ).rejects.toThrow('claimable, unarchived environment');
    });
  });

  describe('updateRole', () => {
    it('updates a role', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [buildRoleRow({ description: 'Updated' })],
          rowCount: 1,
        });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {
        description: 'Updated',
      });

      expect(result.description).toBe('Updated');
    });

    it('updates execution environment references', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: ENVIRONMENT_ID }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [buildRoleRow({ execution_environment_id: ENVIRONMENT_ID })],
          rowCount: 1,
        });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {
        executionEnvironmentId: ENVIRONMENT_ID,
      });

      expect(result.execution_environment_id).toBe(ENVIRONMENT_ID);
      expect(pool.query.mock.calls[2]?.[1]).toContain(ENVIRONMENT_ID);
    });

    it('replaces mcp grants and ordered skill assignments on update', async () => {
      let roleLookupCount = 0;
      pool.query.mockImplementation(async (sql: unknown) => {
        if (typeof sql !== 'string') {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('WHERE rd.tenant_id = $1') && sql.includes('AND rd.id = $2')) {
          roleLookupCount += 1;
          if (roleLookupCount === 1) {
            return { rows: [buildRoleRow()], rowCount: 1 };
          }
          return {
            rows: [
              buildRoleRow({
                mcp_server_ids: [MCP_SERVER_ID],
                skill_ids: [SKILL_ID],
              }),
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM remote_mcp_servers')) {
          return {
            rows: [{
              id: MCP_SERVER_ID,
              is_archived: false,
              verification_status: 'verified',
              already_assigned: false,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM specialist_skills')) {
          return {
            rows: [{
              id: SKILL_ID,
              is_archived: false,
              already_assigned: false,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {
        mcpServerIds: [MCP_SERVER_ID],
        skillIds: [SKILL_ID],
      });

      expect(result.mcp_server_ids).toEqual([MCP_SERVER_ID]);
      expect(result.skill_ids).toEqual([SKILL_ID]);
      expect(
        pool.query.mock.calls.some(
          ([sql]) =>
            typeof sql === 'string' && sql.includes('DELETE FROM specialist_mcp_server_grants'),
        ),
      ).toBe(true);
      expect(
        pool.query.mock.calls.some(
          ([sql]) =>
            typeof sql === 'string' && sql.includes('DELETE FROM specialist_skill_assignments'),
        ),
      ).toBe(true);
    });

    it('allows already-assigned archived MCP servers and skills to remain on update', async () => {
      pool.query.mockImplementation(async (sql: unknown) => {
        if (typeof sql !== 'string') {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('WHERE rd.tenant_id = $1') && sql.includes('AND rd.id = $2')) {
          return {
            rows: [
              buildRoleRow({
                mcp_server_ids: [MCP_SERVER_ID],
                skill_ids: [SKILL_ID],
              }),
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM remote_mcp_servers s')) {
          return {
            rows: [{
              id: MCP_SERVER_ID,
              is_archived: true,
              verification_status: 'failed',
              already_assigned: true,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM specialist_skills s')) {
          return {
            rows: [{
              id: SKILL_ID,
              is_archived: true,
              already_assigned: true,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {
        mcpServerIds: [MCP_SERVER_ID],
        skillIds: [SKILL_ID],
      });

      expect(result.mcp_server_ids).toEqual([MCP_SERVER_ID]);
      expect(result.skill_ids).toEqual([SKILL_ID]);
    });

    it('returns current role when no fields to update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 });

      const result = await service.updateRole(TENANT_ID, ROLE_ID, {});

      expect(result).toEqual(
        expect.objectContaining({
          id: ROLE_ID,
          execution_environment: null,
        }),
      );
    });
  });
});
