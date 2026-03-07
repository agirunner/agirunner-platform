import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../pagination.js';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/audit/logs', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const query = request.query as {
      date_from?: string;
      date_to?: string;
      actor?: string;
      action?: string;
      resource_id?: string;
      page?: string;
      per_page?: string;
    };

    const page = Number(query.page ?? DEFAULT_PAGE);
    const perPage = Number(query.per_page ?? DEFAULT_PER_PAGE);
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(perPage) || perPage <= 0 || perPage > MAX_PER_PAGE) {
      throw new ValidationError('Invalid pagination values');
    }

    return app.auditService.listLogs(request.auth!.tenantId, {
      date_from: query.date_from,
      date_to: query.date_to,
      actor: query.actor,
      action: query.action,
      resource_id: query.resource_id,
      page,
      per_page: perPage,
    });
  });
};
