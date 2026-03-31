import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { NotFoundError } from '../../../errors/domain-errors.js';
import {
  communityCatalogImportPreviewSchema,
  communityCatalogImportSchema,
  parseOrThrow,
} from './schemas.js';

export const communityCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/community-catalog/playbooks',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async () => ({
      data: await app.communityCatalogSourceService.listPlaybooks(),
    }),
  );

  app.get(
    '/api/v1/community-catalog/playbooks/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await app.communityCatalogSourceService.getPlaybookDetail(params.id),
      };
    },
  );

  app.post(
    '/api/v1/community-catalog/import-preview',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = parseOrThrow(communityCatalogImportPreviewSchema, request.body);
      return {
        data: await app.communityCatalogPreviewService.previewImport(request.auth!.tenantId, {
          playbookIds: body.playbook_ids,
        }),
      };
    },
  );

  app.post(
    '/api/v1/community-catalog/import',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = parseOrThrow(communityCatalogImportSchema, request.body);
      const result = await app.communityCatalogImportService.importPlaybooks(request.auth!.tenantId, {
        playbookIds: body.playbook_ids,
        defaultConflictResolution: body.default_conflict_resolution,
        conflictResolutions: body.conflict_resolutions,
      });
      reply.status(201);
      return { data: result };
    },
  );

  app.get(
    '/api/v1/community-catalog/imported-playbooks/:id/origin',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const origin = await app.communityCatalogOriginService.getPlaybookOrigin(
        request.auth!.tenantId,
        params.id,
      );
      if (!origin) {
        throw new NotFoundError('Community catalog origin not found');
      }
      return { data: origin };
    },
  );
};
