import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../../errors/domain-errors.js';
import { applyTenantLoggingLevel } from '../../../logging/execution/platform-log-level.js';
const retentionPolicySchema = z
  .object({
    task_prune_after_days: z.number().int().min(1).optional(),
    workflow_delete_after_days: z.number().int().min(1).optional(),
    execution_log_retention_days: z.number().int().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const loggingConfigSchema = z.object({
  level: z.enum(VALID_LOG_LEVELS),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const governanceRoutes: FastifyPluginAsync = async (app) => {
  const governanceService = app.governanceService;

  app.get(
    '/api/v1/governance/retention-policy',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({
      data: await governanceService.getRetentionPolicy(request.auth!.tenantId),
    }),
  );

  app.put(
    '/api/v1/governance/retention-policy',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = parseOrThrow(retentionPolicySchema.safeParse(request.body ?? {}));
      return { data: await governanceService.updateRetentionPolicy(request.auth!, body) };
    },
  );

  app.get(
    '/api/v1/governance/logging',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const level = await governanceService.getLoggingLevel(request.auth!.tenantId);
      return { data: { level } };
    },
  );

  app.put(
    '/api/v1/governance/logging',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = parseOrThrow(loggingConfigSchema.safeParse(request.body ?? {}));
      const level = await governanceService.setLoggingLevel(request.auth!, body.level);
      app.logLevelCache.invalidate(request.auth!.tenantId);
      await applyTenantLoggingLevel({
        tenantId: request.auth!.tenantId,
        governanceService,
        logger: app.log,
      });
      return { data: { level } };
    },
  );
};
