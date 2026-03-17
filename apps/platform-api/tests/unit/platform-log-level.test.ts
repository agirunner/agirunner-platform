import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TENANT_ID } from '../../src/db/seed.js';
import {
  applyDefaultTenantLoggingLevel,
  applyTenantLoggingLevel,
} from '../../src/logging/platform-log-level.js';

const { configureApiKeyLoggingMock } = vi.hoisted(() => ({
  configureApiKeyLoggingMock: vi.fn(),
}));

vi.mock('../../src/auth/api-key.js', () => ({
  configureApiKeyLogging: configureApiKeyLoggingMock,
}));

describe('platform log level application', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('applies the persisted default-tenant level during startup', async () => {
    const logger = { level: 'info' };
    const governanceService = {
      getLoggingLevel: vi.fn().mockResolvedValue('error'),
    };

    const level = await applyDefaultTenantLoggingLevel({
      governanceService,
      logger,
    });

    expect(governanceService.getLoggingLevel).toHaveBeenCalledWith(DEFAULT_TENANT_ID);
    expect(level).toBe('error');
    expect(logger.level).toBe('error');
    expect(configureApiKeyLoggingMock).toHaveBeenCalledWith('error');
  });

  it('applies a tenant-scoped level update to the live process logger', async () => {
    const logger = { level: 'info' };
    const governanceService = {
      getLoggingLevel: vi.fn().mockResolvedValue('warn'),
    };

    const level = await applyTenantLoggingLevel({
      tenantId: 'tenant-42',
      governanceService,
      logger,
    });

    expect(governanceService.getLoggingLevel).toHaveBeenCalledWith('tenant-42');
    expect(level).toBe('warn');
    expect(logger.level).toBe('warn');
    expect(configureApiKeyLoggingMock).toHaveBeenCalledWith('warn');
  });
});
