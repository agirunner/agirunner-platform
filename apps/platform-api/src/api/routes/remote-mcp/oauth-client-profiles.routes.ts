import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';

export const remoteMcpOAuthClientProfileRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/remote-mcp-oauth-client-profiles',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({
      data: await app.remoteMcpOAuthClientProfileService.listProfiles(request.auth!.tenantId),
    }),
  );

  app.get(
    '/api/v1/remote-mcp-oauth-client-profiles/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.remoteMcpOAuthClientProfileService.getProfile(request.auth!.tenantId, params.id),
      };
    },
  );

  app.post(
    '/api/v1/remote-mcp-oauth-client-profiles',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await app.remoteMcpOAuthClientProfileService.createProfile(
        request.auth!.tenantId,
        request.body as never,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/remote-mcp-oauth-client-profiles/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.remoteMcpOAuthClientProfileService.updateProfile(
          request.auth!.tenantId,
          params.id,
          request.body as never,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/remote-mcp-oauth-client-profiles/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await app.remoteMcpOAuthClientProfileService.deleteProfile(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );
};
