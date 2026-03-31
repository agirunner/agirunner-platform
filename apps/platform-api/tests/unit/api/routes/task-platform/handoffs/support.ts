import { resolve } from 'node:path';
import fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

import { registerErrorHandler } from '../../../../../../src/errors/error-handler.js';
import { taskPlatformRoutes } from '../../../../../../src/api/routes/task-platform/routes.js';

vi.mock('../../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-key',
    };
  },
  withScope: () => async () => {},
}));

export const artifactLocalRoot = resolve('tmp/artifacts');

export function matchDeliverablePromotionQuery(sql: string) {
  if (sql.includes('INSERT INTO workflow_output_descriptors')) {
    return {
      rowCount: 1,
      rows: [{
        id: '00000000-0000-4000-8000-000000000001',
        tenant_id: 'tenant-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        descriptor_kind: 'deliverable_packet',
        delivery_stage: 'final',
        title: 'Work item completion packet',
        state: 'final',
        summary_brief: 'Promoted handoff packet',
        preview_capabilities_json: {
          can_inline_preview: true,
          can_download: false,
          can_open_external: false,
          can_copy_path: false,
          preview_kind: 'structured_summary',
        },
        primary_target_json: {
          target_kind: 'inline_summary',
          label: 'Review completion packet',
        },
        secondary_targets_json: [],
        content_preview_json: {
          summary: 'Promoted handoff packet',
        },
        source_brief_id: null,
        created_at: new Date('2026-03-15T12:00:00Z'),
        updated_at: new Date('2026-03-15T12:00:00Z'),
      }],
    };
  }

  if (sql.includes('FROM workflow_output_descriptors')) {
    if (sql.includes('descriptor_kind IN (\'deliverable_packet\', \'handoff_packet\')')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('content_preview_json->>\'rollup_source_descriptor_id\'')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('AND id = $3')) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (sql.includes('FROM workflow_work_items') && !sql.includes('parent_work_item_id')) {
    if (sql.includes('SELECT id, completed_at')) {
      return {
        rowCount: 1,
        rows: [{
          id: 'work-item-1',
          completed_at: null,
        }],
      };
    }
    return { rowCount: 0, rows: [] };
  }

  if (sql.includes('SELECT id') && sql.includes('FROM workflows')) {
    return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
  }

  return null;
}

export function buildTaskPlatformHandoffsApp(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
  const app = fastify();
  registerErrorHandler(app);
  app.decorate('pgPool', {
    query,
  } as never);
  app.decorate('workspaceService', {} as never);
  app.decorate('config', {
    ARTIFACT_STORAGE_BACKEND: 'local',
    ARTIFACT_LOCAL_ROOT: artifactLocalRoot,
    ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
    ARTIFACT_PREVIEW_MAX_BYTES: 1024,
  } as never);
  return app;
}

export async function registerTaskPlatformHandoffsRoutes(app: FastifyInstance) {
  await app.register(taskPlatformRoutes);
}
