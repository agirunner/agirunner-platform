import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withAllowedScopes } from '../../auth/fastify-auth-hook.js';

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const missionControlRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [authenticateApiKey, withAllowedScopes(['agent', 'admin'])] };

  app.get('/api/v1/mission-control/live', auth, async (request) => {
    const query = request.query as { page?: string; per_page?: string };
    return app.missionControlLiveService.getLive(request.auth!.tenantId, {
      page: readPositiveInt(query.page, 1),
      perPage: readPositiveInt(query.per_page, 100),
    });
  });

  app.get('/api/v1/mission-control/recent', auth, async (request) => {
    const query = request.query as { limit?: string };
    return app.missionControlRecentService.getRecent(request.auth!.tenantId, {
      limit: readPositiveInt(query.limit, 50),
    });
  });

  app.get('/api/v1/mission-control/history', auth, async (request) => {
    const query = request.query as { workflow_id?: string; limit?: string };
    return app.missionControlHistoryService.getHistory(request.auth!.tenantId, {
      workflowId: query.workflow_id,
      limit: readPositiveInt(query.limit, 100),
    });
  });

  app.get('/api/v1/mission-control/workflows/:id/workspace', auth, async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { history_limit?: string; output_limit?: string };
    return app.missionControlWorkspaceService.getWorkspace(request.auth!.tenantId, params.id, {
      historyLimit: readPositiveInt(query.history_limit, 50),
      outputLimit: readPositiveInt(query.output_limit, 5),
    });
  });
};
