import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../../../src/errors/error-handler.js';
import { workflowActivationRoutes } from '../../../../../src/api/routes/workflows/activations.routes.js';

vi.mock('../../../../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'admin-1',
    };
  },
  withScope: () => async () => {},
}));

describe('workflow activation routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('enqueues manual activations when request_id is provided', async () => {
    const enqueue = vi.fn(async () => ({
      id: 'activation-1',
      workflow_id: 'workflow-1',
      request_id: 'activation-request-1',
    }));

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowActivationService', {
      enqueue,
      list: async () => ({ data: [] }),
      get: async () => ({ data: {} }),
    });
    await app.register(workflowActivationRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/activations',
      payload: {
        request_id: 'activation-request-1',
        reason: 'Manual wake',
        event_type: 'work_item.created',
        payload: {
          work_item_id: 'work-item-1',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({
      mutation_outcome: 'applied',
      result: {
        id: 'activation-1',
        workflow_id: 'workflow-1',
        request_id: 'activation-request-1',
      },
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'activation-request-1',
        reason: 'Manual wake',
        event_type: 'work_item.created',
      }),
    );
  });

  it('rejects manual activation enqueue without request_id', async () => {
    const enqueue = vi.fn();

    app = fastify();
    registerErrorHandler(app);
    app.decorate('workflowActivationService', {
      enqueue,
      list: async () => ({ data: [] }),
      get: async () => ({ data: {} }),
    });
    await app.register(workflowActivationRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/activations',
      payload: {
        reason: 'Manual wake',
        event_type: 'work_item.created',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
