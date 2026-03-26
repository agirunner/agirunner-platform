import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';

export const remoteMcpServerRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/v1/remote-mcp-servers/oauth/authorize',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const userId = request.auth!.userId ?? request.auth!.ownerId ?? request.auth!.id;
      return {
        data: await app.remoteMcpOAuthService.initiateDraftAuthorization(
          request.auth!.tenantId,
          userId,
          request.body as never,
        ),
      };
    },
  );

  app.get(
    '/api/v1/remote-mcp-servers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({
      data: await app.remoteMcpServerService.listServers(request.auth!.tenantId),
    }),
  );

  app.get(
    '/api/v1/remote-mcp-servers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await app.remoteMcpServerService.getServer(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/remote-mcp-servers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await app.remoteMcpVerificationService.createServer(
        request.auth!.tenantId,
        request.body as never,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/remote-mcp-servers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.remoteMcpVerificationService.updateServer(
          request.auth!.tenantId,
          params.id,
          request.body as never,
        ),
      };
    },
  );

  app.post(
    '/api/v1/remote-mcp-servers/:id/oauth/reconnect',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const userId = request.auth!.userId ?? request.auth!.ownerId ?? request.auth!.id;
      return {
        data: await app.remoteMcpOAuthService.reconnectServer(
          request.auth!.tenantId,
          userId,
          params.id,
        ),
      };
    },
  );

  app.post(
    '/api/v1/remote-mcp-servers/:id/oauth/disconnect',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await app.remoteMcpOAuthService.disconnectServer(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );

  app.post(
    '/api/v1/remote-mcp-servers/:id/reverify',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await app.remoteMcpVerificationService.reverifyServer(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/remote-mcp-servers/:id/archive',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await app.remoteMcpServerService.setArchived(request.auth!.tenantId, params.id, true) };
    },
  );

  app.post(
    '/api/v1/remote-mcp-servers/:id/unarchive',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await app.remoteMcpServerService.setArchived(request.auth!.tenantId, params.id, false) };
    },
  );
};
