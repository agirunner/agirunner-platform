import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionEnvironmentVerificationService } from '../../../src/services/execution-environment/verification-service.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ENVIRONMENT_ID = '00000000-0000-0000-0000-000000000777';

function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

function buildEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    id: ENVIRONMENT_ID,
    image: 'ubuntu:24.04',
    cpu: '2',
    memory: '1Gi',
    pull_policy: 'if-not-present',
    bootstrap_commands: ['sh', 'grep'],
    bootstrap_required_domains: [],
    support_status: 'active',
    ...overrides,
  };
}

describe('ExecutionEnvironmentVerificationService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let environmentService: {
    getEnvironment: ReturnType<typeof vi.fn>;
  };
  let verifier: {
    verify: ReturnType<typeof vi.fn>;
  };
  let service: ExecutionEnvironmentVerificationService;

  beforeEach(() => {
    pool = createMockPool();
    environmentService = {
      getEnvironment: vi.fn(),
    };
    verifier = {
      verify: vi.fn(),
    };
    service = new ExecutionEnvironmentVerificationService(
      pool as never,
      environmentService as never,
      verifier as never,
    );
  });

  it('sanitizes null bytes before persisting verification output', async () => {
    environmentService.getEnvironment
      .mockResolvedValueOnce(buildEnvironment())
      .mockResolvedValueOnce(buildEnvironment({ is_claimable: true }));
    verifier.verify.mockResolvedValueOnce({
      compatibility_status: 'compatible',
      compatibility_errors: ['probe\u0000warning'],
      verification_contract_version: 'v1',
      verified_metadata: {
        distro: 'ubuntu\u0000',
        shell: '/bin/sh',
      },
      tool_capabilities: {
        verified_baseline_commands: ['sh', 'grep\u0000'],
      },
      probe_output: {
        raw_output: '\u0001\u0000binary',
        nested: { stderr: 'warn\u0000ing' },
      },
    });

    await service.verifyEnvironment(TENANT_ID, ENVIRONMENT_ID);

    const insertParams = pool.query.mock.calls[0]?.[1] as unknown[];
    const updateParams = pool.query.mock.calls[1]?.[1] as unknown[];

    expect(JSON.parse(insertParams[5] as string)).toEqual({
      raw_output: '\u0001binary',
      nested: { stderr: 'warning' },
    });
    expect(JSON.parse(insertParams[6] as string)).toEqual(['probewarning']);
    expect(JSON.parse(updateParams[3] as string)).toEqual(['probewarning']);
    expect(JSON.parse(updateParams[5] as string)).toEqual({
      distro: 'ubuntu',
      shell: '/bin/sh',
    });
    expect(JSON.parse(updateParams[6] as string)).toEqual({
      verified_baseline_commands: ['sh', 'grep'],
    });
  });
});
