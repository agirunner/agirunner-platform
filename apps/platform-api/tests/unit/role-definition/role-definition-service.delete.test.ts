import { beforeEach, describe, expect, it } from 'vitest';

import { RoleDefinitionService } from '../../../src/services/role-definition-service.js';
import {
  buildRoleRow,
  createMockPool,
  ROLE_ID,
  TENANT_ID,
} from './role-definition-test-fixtures.js';

describe('RoleDefinitionService deleteRole', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: RoleDefinitionService;

  beforeEach(() => {
    pool = createMockPool();
    service = new RoleDefinitionService(pool as never);
  });

  it('deletes a role not used by any playbook', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(service.deleteRole(TENANT_ID, ROLE_ID)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      'DELETE FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
      [TENANT_ID, 'developer'],
    );
  });

  it('rejects delete when role is used by playbook', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ name: 'SDLC' }], rowCount: 1 });

    await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow('used by playbook');
  });

  it('rejects delete when a workflow-linked inactive playbook version still uses the role', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ name: 'SDLC v4' }], rowCount: 1 });

    await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow(
      'referenced by workflow',
    );
  });

  it('throws NotFoundError when role does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.deleteRole(TENANT_ID, ROLE_ID)).rejects.toThrow(
      'Role definition not found',
    );
  });
});
