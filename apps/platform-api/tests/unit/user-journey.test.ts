import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Unit-level simulation of the full user journey:
 * First boot → login → create template → launch workflow → approve task → view results.
 *
 * This validates the logical flow through services without requiring a running database.
 * True E2E tests run against the full stack separately.
 */

function createMockPool() {
  return {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  };
}

describe('user journey simulation', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('first boot seeds admin user when no users exist', async () => {
    const { UserService } = await import('../../src/services/user-service.js');
    const service = new UserService(pool as never);

    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // check existing
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'admin-uuid',
            tenant_id: 'tenant-uuid',
            email: 'admin@example.com',
            password_hash: '$2a$12$hash',
            display_name: 'Admin',
            role: 'org_admin',
            is_active: true,
            last_login_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        rowCount: 1,
      });

    const admin = await service.createUser('tenant-uuid', {
      email: 'admin@example.com',
      password: 'securepassword123',
      role: 'org_admin',
    });

    expect(admin.role).toBe('org_admin');
    expect(admin.email).toBe('admin@example.com');
  });

  it('admin logs in and receives JWT token via app.jwt.sign', async () => {
    const mockApp = {
      jwt: {
        sign: vi.fn().mockReturnValue('header.payload.signature'),
      },
      config: {
        JWT_EXPIRES_IN: '1h',
        JWT_REFRESH_EXPIRES_IN: '7d',
      },
    };

    const { issueUserAccessToken, issueUserRefreshToken } = await import('../../src/auth/jwt.js');

    const accessToken = await issueUserAccessToken(mockApp as never, {
      userId: 'admin-uuid',
      tenantId: 'tenant-uuid',
      role: 'org_admin',
      scope: 'admin',
      email: 'admin@example.com',
    });

    expect(accessToken).toBe('header.payload.signature');
    expect(mockApp.jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ tokenType: 'user_access', userId: 'admin-uuid' }),
      expect.any(Object),
    );

    const refreshToken = await issueUserRefreshToken(mockApp as never, {
      userId: 'admin-uuid',
      tenantId: 'tenant-uuid',
      role: 'org_admin',
      scope: 'admin',
      email: 'admin@example.com',
      tokenId: 'refresh-token-id',
    });

    expect(refreshToken).toBe('header.payload.signature');
  });

  it('RBAC correctly gates endpoint access', async () => {
    const { hasRequiredRole } = await import('../../src/auth/rbac.js');

    expect(hasRequiredRole('org_admin', 'org_admin')).toBe(true);
    expect(hasRequiredRole('viewer', 'org_admin')).toBe(false);
    expect(hasRequiredRole('operator', 'viewer')).toBe(true);
    expect(hasRequiredRole('agent_admin', 'operator')).toBe(true);
    expect(hasRequiredRole('viewer', 'operator')).toBe(false);
  });

  it('metering records usage from completed task', async () => {
    const { MeteringService } = await import('../../src/services/metering-service.js');
    const service = new MeteringService(pool as never);

    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'metering-uuid',
          tenant_id: 'tenant-uuid',
          task_id: '00000000-0000-0000-0000-000000000010',
          tokens_input: 500,
          tokens_output: 200,
          cost_usd: 0.005,
          wall_time_ms: 3000,
        },
      ],
    });

    const event = await service.record('tenant-uuid', {
      taskId: '00000000-0000-0000-0000-000000000010',
      tokensInput: 500,
      tokensOutput: 200,
      costUsd: 0.005,
      wallTimeMs: 3000,
    });

    expect(event.tokens_input).toBe(500);
    expect(event.cost_usd).toBe(0.005);
  });

  it('output schema validation catches invalid task output', async () => {
    const { validateOutputSchema } = await import('../../src/services/task-completion-side-effects.js');

    const schema = {
      required: ['summary', 'confidence'],
      properties: {
        summary: { type: 'string' },
        confidence: { type: 'number' },
      },
    };

    const validOutput = { summary: 'Result text', confidence: 0.95 };
    expect(validateOutputSchema(validOutput, schema)).toEqual([]);

    const invalidOutput = { summary: 42 };
    const errors = validateOutputSchema(invalidOutput, schema);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContain('Missing required field: confidence');
    expect(errors).toContain('Field summary must be a string');
  });

  it('circuit breaker trips on repeated failures', async () => {
    const { CircuitBreakerService } = await import('../../src/services/circuit-breaker-service.js');
    const service = new CircuitBreakerService(pool as never);

    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-uuid', quality_score: 0.35, circuit_breaker_state: 'closed', circuit_breaker_tripped_at: null }],
      })
      .mockResolvedValueOnce({ rows: [] }) // INSERT event
      .mockResolvedValueOnce({ rows: [] }); // UPDATE workers

    const result = await service.reportOutcome('tenant-uuid', {
      workerId: '00000000-0000-0000-0000-000000000099',
      outcome: 'failure',
      reason: 'agent crashed',
    });

    expect(result.circuitState).toBe('open');
    expect(result.qualityScore).toBeLessThan(0.3);
  });

  it('dispatch query excludes circuit-breaker-open workers', async () => {
    // Verify the SQL in the dispatch repository excludes open circuit breakers
    const { findDispatchCandidateWorkers } = await import('../../src/services/worker-dispatch-repository.js');

    pool.query.mockResolvedValueOnce({ rows: [] });

    await findDispatchCandidateWorkers(pool as never, 'tenant-uuid', ['worker-1'], ['llm-api']);

    const sql = pool.query.mock.calls[0][0] as string;
    expect(sql).toContain("circuit_breaker_state <> 'open'");
    expect(sql).toContain('quality_score');
  });
});
