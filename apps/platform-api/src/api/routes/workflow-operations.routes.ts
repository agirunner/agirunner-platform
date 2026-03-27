import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withAllowedScopes } from '../../auth/fastify-auth-hook.js';

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const workflowOperationsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] };

  async function handleLive(request: {
    auth?: { tenantId: string };
    query: { page?: string; per_page?: string };
  }) {
    const query = request.query;
    return {
      data: await app.workflowOperationsLiveService.getLive(request.auth!.tenantId, {
        page: readPositiveInt(query.page, 1),
        perPage: readPositiveInt(query.per_page, 100),
      }),
    };
  }

  async function handleRecent(request: {
    auth?: { tenantId: string };
    query: { limit?: string };
  }) {
    const query = request.query;
    return {
      data: await app.workflowOperationsRecentService.getRecent(request.auth!.tenantId, {
        limit: readPositiveInt(query.limit, 50),
      }),
    };
  }

  async function handleHistory(request: {
    auth?: { tenantId: string };
    query: { workflow_id?: string; limit?: string };
  }) {
    const query = request.query;
    return {
      data: await app.workflowOperationsHistoryService.getHistory(request.auth!.tenantId, {
        workflowId: query.workflow_id,
        limit: readPositiveInt(query.limit, 100),
      }),
    };
  }

  async function handleWorkspace(request: {
    auth?: { tenantId: string };
    params: { id: string };
    query: { history_limit?: string; output_limit?: string };
  }) {
    const params = request.params;
    const query = request.query;
    return {
      data: await app.workflowOperationsWorkspaceService.getWorkspace(request.auth!.tenantId, params.id, {
        historyLimit: readPositiveInt(query.history_limit, 50),
        outputLimit: readPositiveInt(query.output_limit, 5),
      }),
    };
  }

  app.get('/api/v1/operations/workflows', auth, async (request) => {
    const query = request.query as { mode?: string; page?: string; per_page?: string; limit?: string; workflow_id?: string };
    switch (query.mode) {
      case 'recent':
        return handleRecent(request as never);
      case 'history':
        return handleHistory(request as never);
      case 'live':
      default:
        return handleLive(request as never);
    }
  });

  app.get('/api/v1/operations/workflows/:id/workspace', auth, (request) => handleWorkspace(request as never));

  app.get('/api/v1/mission-control/live', auth, (request) => handleLive(request as never));
  app.get('/api/v1/mission-control/recent', auth, (request) => handleRecent(request as never));
  app.get('/api/v1/mission-control/history', auth, (request) => handleHistory(request as never));
  app.get('/api/v1/mission-control/workflows/:id/workspace', auth, (request) =>
    handleWorkspace(request as never),
  );
};
