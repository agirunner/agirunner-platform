import { beforeEach, describe, expect, it } from 'vitest';

import { RoleDefinitionService } from '../../../src/services/role-definition/role-definition-service.js';
import {
  buildRoleRow,
  createMockPool,
  ROLE_ID,
  TENANT_ID,
} from './role-definition-test-fixtures.js';

describe('RoleDefinitionService secret redaction', () => {
  const REDACTED = 'redacted://role-definition-secret';

  let pool: ReturnType<typeof createMockPool>;
  let service: RoleDefinitionService;

  beforeEach(() => {
    pool = createMockPool();
    service = new RoleDefinitionService(pool as never);
  });

  it('redacts secret references in system_prompt via listRoles', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [buildRoleRow({ system_prompt: 'secret:provider-api-key-openai' })],
      rowCount: 1,
    });

    const result = await service.listRoles(TENANT_ID);

    expect(result[0]?.system_prompt).toBe(REDACTED);
  });

  it('redacts secret references in system_prompt via getRoleById', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [buildRoleRow({ system_prompt: 'secret:github-token-prod' })],
      rowCount: 1,
    });

    const result = await service.getRoleById(TENANT_ID, ROLE_ID);

    expect(result.system_prompt).toBe(REDACTED);
  });

  it('redacts secret references in system_prompt via getRoleByName', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [buildRoleRow({ system_prompt: 'secret:my-db-password' })],
      rowCount: 1,
    });

    const result = await service.getRoleByName(TENANT_ID, 'developer');

    expect(result?.system_prompt).toBe(REDACTED);
  });

  it('redacts secret references in system_prompt via createRole', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [buildRoleRow({ system_prompt: 'secret:openai-key' })],
        rowCount: 1,
      });

    const result = await service.createRole(TENANT_ID, {
      name: 'developer',
      systemPrompt: 'secret:openai-key',
      allowedTools: [],
    });

    expect(result.system_prompt).toBe(REDACTED);
  });

  it('redacts secret references in system_prompt via updateRole', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildRoleRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: ROLE_ID }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [buildRoleRow({ system_prompt: 'secret:github-token-prod' })],
        rowCount: 1,
      });

    const result = await service.updateRole(TENANT_ID, ROLE_ID, {
      systemPrompt: 'secret:github-token-prod',
    });

    expect(result.system_prompt).toBe(REDACTED);
  });

  it('preserves non-secret content and Date fields through sanitization', async () => {
    const now = new Date();
    pool.query.mockResolvedValueOnce({
      rows: [buildRoleRow({ created_at: now, updated_at: now })],
      rowCount: 1,
    });

    const result = await service.getRoleById(TENANT_ID, ROLE_ID);

    expect(result.system_prompt).toBe('You are a developer.');
    expect(result.description).toBe('Implements features');
    expect(result.created_at).toEqual(now);
    expect(result.updated_at).toEqual(now);
  });

  it('redacts encrypted values in description and model preference fields', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        buildRoleRow({
          description: 'enc:v1:ciphertext-data-here',
          model_preference: 'secret:custom-model-key',
        }),
      ],
      rowCount: 1,
    });

    const result = await service.getRoleById(TENANT_ID, ROLE_ID);

    expect(result.description).toBe(REDACTED);
    expect(result.model_preference).toBe(REDACTED);
  });
});
