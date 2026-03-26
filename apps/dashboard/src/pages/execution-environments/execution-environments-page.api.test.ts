import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardExecutionEnvironmentRecord } from '../../lib/api.js';

const dashboardApi = {
  listExecutionEnvironments: vi.fn(),
  createExecutionEnvironment: vi.fn(),
  updateExecutionEnvironment: vi.fn(),
  verifyExecutionEnvironment: vi.fn(),
};

vi.mock('../../lib/api.js', () => ({
  dashboardApi,
}));

function buildEnvironment(
  overrides: Partial<DashboardExecutionEnvironmentRecord> = {},
): DashboardExecutionEnvironmentRecord {
  return {
    id: 'environment-1',
    name: 'Debian Base',
    description: null,
    source_kind: 'custom',
    catalog_key: null,
    catalog_version: null,
    image: 'debian:trixie-slim',
    cpu: '2',
    memory: '1Gi',
    pull_policy: 'if-not-present',
    bootstrap_commands: [],
    bootstrap_required_domains: [],
    operator_notes: null,
    declared_metadata: {},
    compatibility_status: 'unknown',
    compatibility_errors: [],
    support_status: null,
    verification_contract_version: null,
    verified_metadata: {},
    tool_capabilities: {},
    agent_hint: '',
    is_default: false,
    is_archived: false,
    is_claimable: false,
    last_verified_at: null,
    usage_count: 0,
    created_at: '2026-03-25T00:00:00.000Z',
    updated_at: '2026-03-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('execution environments page api', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates then verifies a new environment', async () => {
    const savedEnvironment = buildEnvironment({
      id: 'environment-created',
      name: 'Ubuntu Base',
    });
    const verifiedEnvironment = buildEnvironment({
      id: 'environment-created',
      name: 'Ubuntu Base',
      compatibility_status: 'compatible',
      is_claimable: true,
    });
    dashboardApi.createExecutionEnvironment.mockResolvedValue(savedEnvironment);
    dashboardApi.verifyExecutionEnvironment.mockResolvedValue(verifiedEnvironment);

    const { saveExecutionEnvironmentAndVerify } = await import('./execution-environments-page.api.js');

    await expect(
      saveExecutionEnvironmentAndVerify({
        mode: 'create',
        payload: {
          name: 'Ubuntu Base',
          image: 'ubuntu:24.04',
          cpu: '2',
          memory: '1Gi',
          pullPolicy: 'if-not-present',
        },
      }),
    ).resolves.toEqual(verifiedEnvironment);

    expect(dashboardApi.createExecutionEnvironment).toHaveBeenCalledOnce();
    expect(dashboardApi.verifyExecutionEnvironment).toHaveBeenCalledWith('environment-created');
  });

  it('updates then verifies an existing environment', async () => {
    const savedEnvironment = buildEnvironment({
      id: 'environment-2',
      name: 'Fedora Base',
    });
    const verifiedEnvironment = buildEnvironment({
      id: 'environment-2',
      name: 'Fedora Base',
      compatibility_status: 'compatible',
      is_claimable: true,
    });
    dashboardApi.updateExecutionEnvironment.mockResolvedValue(savedEnvironment);
    dashboardApi.verifyExecutionEnvironment.mockResolvedValue(verifiedEnvironment);

    const { saveExecutionEnvironmentAndVerify } = await import('./execution-environments-page.api.js');

    await expect(
      saveExecutionEnvironmentAndVerify({
        mode: 'edit',
        environmentId: 'environment-2',
        payload: {
          name: 'Fedora Base',
          image: 'fedora:42',
        },
      }),
    ).resolves.toEqual(verifiedEnvironment);

    expect(dashboardApi.updateExecutionEnvironment).toHaveBeenCalledWith(
      'environment-2',
      expect.objectContaining({ image: 'fedora:42' }),
    );
    expect(dashboardApi.verifyExecutionEnvironment).toHaveBeenCalledWith('environment-2');
  });

  it('preserves saved environment context when automatic verification fails', async () => {
    const savedEnvironment = buildEnvironment({
      id: 'environment-3',
      name: 'Manual Ubuntu',
    });
    dashboardApi.createExecutionEnvironment.mockResolvedValue(savedEnvironment);
    dashboardApi.verifyExecutionEnvironment.mockRejectedValue(new Error('HTTP 502'));

    const {
      ExecutionEnvironmentAutoVerifyError,
      saveExecutionEnvironmentAndVerify,
    } = await import('./execution-environments-page.api.js');

    await expect(
      saveExecutionEnvironmentAndVerify({
        mode: 'create',
        payload: {
          name: 'Manual Ubuntu',
          image: 'ubuntu:24.04',
          cpu: '2',
          memory: '1Gi',
          pullPolicy: 'if-not-present',
        },
      }),
    ).rejects.toMatchObject({
      name: 'ExecutionEnvironmentAutoVerifyError',
      savedEnvironment,
      message: 'Saved environment Manual Ubuntu, but automatic verification failed: HTTP 502',
    });

    expect(ExecutionEnvironmentAutoVerifyError).toBeDefined();
  });
});
