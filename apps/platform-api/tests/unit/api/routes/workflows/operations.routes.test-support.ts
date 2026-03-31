import fastify from 'fastify';
import { vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';

export function createWorkflowOperationsRoutesApp(input: {
  workflowOperationsRailService?: object;
  workflowOperationsWorkspaceService?: object;
  workflowOperationsStreamService?: object;
  eventStreamService?: object;
  logStreamService?: object;
}) {
  const app = fastify();
  registerErrorHandler(app);
  app.decorate(
    'workflowOperationsRailService',
    (input.workflowOperationsRailService ?? {
      getRail: vi.fn(async () => ({ rows: [], ongoing_rows: [], selected_workflow_id: null })),
    }) as never,
  );
  app.decorate(
    'workflowOperationsWorkspaceService',
    (input.workflowOperationsWorkspaceService ?? {
      getWorkspace: vi.fn(async () => ({ workflow_id: 'workflow-1' })),
    }) as never,
  );
  app.decorate(
    'workflowOperationsStreamService',
    (input.workflowOperationsStreamService ?? {
      buildRailBatch: vi.fn(async () => ({
        cursor: 'workflow-operations:42',
        snapshot_version: 'workflow-operations:42',
        events: [],
      })),
      buildWorkspaceBatch: vi.fn(async () => ({
        cursor: 'workflow-operations:42',
        snapshot_version: 'workflow-operations:42',
        events: [],
      })),
    }) as never,
  );
  app.decorate(
    'eventStreamService',
    (input.eventStreamService ?? {
      subscribe: vi.fn(() => () => undefined),
    }) as never,
  );
  app.decorate(
    'logStreamService',
    (input.logStreamService ?? {
      subscribe: vi.fn(() => () => undefined),
    }) as never,
  );
  return app;
}
