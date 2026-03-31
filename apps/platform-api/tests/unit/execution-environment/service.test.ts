import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { ExecutionEnvironmentService } from '../../../src/services/execution-environment/service.js';
import type { ExecutionEnvironmentRow } from '../../../src/services/execution-environment/types.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function buildEnvironmentRow(overrides: Partial<ExecutionEnvironmentRow> = {}): ExecutionEnvironmentRow {
  return {
    id: '00000000-0000-0000-0000-000000000101',
    tenant_id: TENANT_ID,
    slug: 'specialist-env',
    name: 'Specialist Environment',
    description: 'Role environment',
    source_kind: 'custom',
    catalog_key: null,
    catalog_version: null,
    image: 'ubuntu:24.04',
    cpu: '2',
    memory: '1Gi',
    pull_policy: 'if-not-present',
    bootstrap_commands: ['bash', 'grep'],
    bootstrap_required_domains: ['example.com'],
    operator_notes: null,
    declared_metadata: {},
    verified_metadata: { distro: 'ubuntu' },
    tool_capabilities: { verified_baseline_commands: ['bash', 'grep'] },
    compatibility_status: 'compatible',
    compatibility_errors: [],
    verification_contract_version: 'v1',
    last_verified_at: new Date('2026-03-01T00:00:00.000Z'),
    is_default: false,
    is_archived: false,
    is_claimable: true,
    created_at: new Date('2026-03-01T00:00:00.000Z'),
    updated_at: new Date('2026-03-01T00:00:00.000Z'),
    support_status: null,
    usage_count: 0,
    ...overrides,
  };
}

describe('ExecutionEnvironmentService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let service: ExecutionEnvironmentService;

  beforeEach(() => {
    pool = {
      query: vi.fn(),
    };
    service = new ExecutionEnvironmentService(pool as never, {
      getCatalogEntry: vi.fn(),
    } as never);
  });

  it('resolves a claimable role-scoped execution environment', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ execution_environment_id: '00000000-0000-0000-0000-000000000101' }],
      })
      .mockResolvedValueOnce({
        rows: [buildEnvironmentRow()],
      });

    const result = await service.resolveTaskExecutionEnvironment(TENANT_ID, ' specialist ');

    expect(result.executionContainer).toEqual({
      image: 'ubuntu:24.04',
      cpu: '2',
      memory: '1Gi',
      pull_policy: 'if-not-present',
    });
    expect(result.executionEnvironment.id).toBe('00000000-0000-0000-0000-000000000101');
    expect(result.snapshot.id).toBe('00000000-0000-0000-0000-000000000101');
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT execution_environment_id'),
      [TENANT_ID, 'specialist'],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('AND ee.is_claimable = true'),
      [TENANT_ID, '00000000-0000-0000-0000-000000000101'],
    );
  });

  it('rejects resolution when no claimable environment is available', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ execution_environment_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    await expect(service.resolveTaskExecutionEnvironment(TENANT_ID, 'specialist')).rejects.toThrowError(
      new ValidationError(
        'No claimable Specialist Execution environment is configured for this role or tenant default',
      ),
    );
  });
});
