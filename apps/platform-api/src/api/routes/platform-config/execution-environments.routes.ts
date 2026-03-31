import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const createEnvironmentSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(1000).optional(),
    image: z.string().min(1).max(500),
    cpu: z.string().min(1).max(50),
    memory: z.string().min(1).max(50),
    pullPolicy: z.enum(['always', 'if-not-present', 'never']),
    bootstrapCommands: z.array(z.string().min(1).max(500)).max(50).optional(),
    bootstrapRequiredDomains: z.array(z.string().min(1).max(500)).max(50).optional(),
    operatorNotes: z.string().max(5000).optional(),
  })
  .strict();

const createFromCatalogSchema = z
  .object({
    catalogKey: z.string().min(1).max(100),
    catalogVersion: z.number().int().min(1),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    operatorNotes: z.string().max(5000).optional(),
  })
  .strict();

const updateEnvironmentSchema = createEnvironmentSchema.partial().extend({
  description: z.string().max(1000).nullable().optional(),
  operatorNotes: z.string().max(5000).nullable().optional(),
});

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const executionEnvironmentRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/execution-environment-catalog',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async () => ({ data: await app.executionEnvironmentCatalogService.listCatalog() }),
  );

  app.get(
    '/api/v1/execution-environment-catalog/:catalogKey/:catalogVersion',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { catalogKey: string; catalogVersion: string };
      return {
        data: await app.executionEnvironmentCatalogService.getCatalogEntry(
          params.catalogKey,
          Number(params.catalogVersion),
        ),
      };
    },
  );

  app.get(
    '/api/v1/execution-environments',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({
      data: await app.executionEnvironmentService.listEnvironments(request.auth!.tenantId),
    }),
  );

  app.get(
    '/api/v1/execution-environments/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await app.executionEnvironmentService.getEnvironment(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/execution-environments',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = parseOrThrow(createEnvironmentSchema.safeParse(request.body));
      const created = await app.executionEnvironmentService.createEnvironment(
        request.auth!.tenantId,
        body,
      );
      reply.status(201);
      return { data: created };
    },
  );

  app.post(
    '/api/v1/execution-environments/from-catalog',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = parseOrThrow(createFromCatalogSchema.safeParse(request.body));
      const created = await app.executionEnvironmentService.createFromCatalog(
        request.auth!.tenantId,
        body,
      );
      reply.status(201);
      return { data: created };
    },
  );

  app.patch(
    '/api/v1/execution-environments/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(updateEnvironmentSchema.safeParse(request.body));
      return {
        data: await app.executionEnvironmentService.updateEnvironment(
          request.auth!.tenantId,
          params.id,
          body,
        ),
      };
    },
  );

  app.post(
    '/api/v1/execution-environments/:id/verify',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.executionEnvironmentVerificationService.verifyEnvironment(
          request.auth!.tenantId,
          params.id,
        ),
      };
    },
  );

  app.post(
    '/api/v1/execution-environments/:id/set-default',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.executionEnvironmentService.setDefaultEnvironment(
          request.auth!.tenantId,
          params.id,
        ),
      };
    },
  );

  app.post(
    '/api/v1/execution-environments/:id/archive',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.executionEnvironmentService.setArchived(
          request.auth!.tenantId,
          params.id,
          true,
        ),
      };
    },
  );

  app.post(
    '/api/v1/execution-environments/:id/unarchive',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.executionEnvironmentService.setArchived(
          request.auth!.tenantId,
          params.id,
          false,
        ),
      };
    },
  );
};
