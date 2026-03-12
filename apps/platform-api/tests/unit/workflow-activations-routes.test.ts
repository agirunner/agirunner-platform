import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { workflowActivationRoutes } from '../../src/api/routes/workflow-activations.routes.js';

describe('workflow activation routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('does not register removed claim and complete endpoints', async () => {
    app = fastify();
    app.decorate('workflowActivationService', {
      enqueue: async () => ({}),
      list: async () => ({ data: [] }),
      get: async () => ({ data: {} }),
    });
    await app.register(workflowActivationRoutes);

    const routes = app.printRoutes();

    expect(routes).not.toContain('/api/v1/workflows/:id/activations/claim');
    expect(routes).not.toContain('/api/v1/workflows/:id/activations/:activationId/complete');
    expect(routes).toContain(':activationId (GET, HEAD)');
  });
});
