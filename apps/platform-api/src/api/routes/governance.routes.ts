import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';
const retentionPolicySchema = z
  .object({
    task_archive_after_days: z.number().int().min(1).optional(),
    task_delete_after_days: z.number().int().min(1).optional(),
    audit_log_retention_days: z.number().int().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

const legalHoldSchema = z.object({
  enabled: z.boolean(),
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
    async (request) => ({ data: await governanceService.getRetentionPolicy(request.auth!.tenantId) }),
  );

  app.put(
    '/api/v1/governance/retention-policy',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = parseOrThrow(retentionPolicySchema.safeParse(request.body ?? {}));
      return { data: await governanceService.updateRetentionPolicy(request.auth!, body) };
    },
  );

  app.put(
    '/api/v1/governance/legal-holds/tasks/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(legalHoldSchema.safeParse(request.body ?? {}));
      return { data: await governanceService.setTaskLegalHold(request.auth!, params.id, body.enabled) };
    },
  );

  app.put(
    '/api/v1/governance/legal-holds/workflows/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(legalHoldSchema.safeParse(request.body ?? {}));
      return { data: await governanceService.setWorkflowLegalHold(request.auth!, params.id, body.enabled) };
    },
  );
};
