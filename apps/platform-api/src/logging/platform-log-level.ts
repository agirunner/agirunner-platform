import { configureApiKeyLogging } from '../auth/api-key.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';

interface GovernanceLogLevelReader {
  getLoggingLevel(tenantId: string): Promise<string>;
}

interface MutableProcessLogger {
  level: string;
}

interface ApplyTenantLoggingLevelOptions {
  tenantId: string;
  governanceService: GovernanceLogLevelReader;
  logger: MutableProcessLogger;
}

interface ApplyDefaultTenantLoggingLevelOptions {
  governanceService: GovernanceLogLevelReader;
  logger: MutableProcessLogger;
}

export async function applyTenantLoggingLevel({
  tenantId,
  governanceService,
  logger,
}: ApplyTenantLoggingLevelOptions): Promise<string> {
  const level = await governanceService.getLoggingLevel(tenantId);
  logger.level = level;
  configureApiKeyLogging(level);
  return level;
}

export async function applyDefaultTenantLoggingLevel({
  governanceService,
  logger,
}: ApplyDefaultTenantLoggingLevelOptions): Promise<string> {
  return applyTenantLoggingLevel({
    tenantId: DEFAULT_TENANT_ID,
    governanceService,
    logger,
  });
}
