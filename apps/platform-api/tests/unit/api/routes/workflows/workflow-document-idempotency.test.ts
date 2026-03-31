import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTransactionalWorkflowReplayPool,
  createWorkflowDocument,
  createWorkflowRoutesApp,
  deleteWorkflowDocument,
  resetWorkflowRouteAuthMocks,
  updateWorkflowDocument,
  workflowRoutes,
} from './support.js';

describe('workflow routes document idempotency', () => {
  let app: ReturnType<typeof createWorkflowRoutesApp> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    resetWorkflowRouteAuthMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    vi.clearAllMocks();
  });

  it('deduplicates repeated workflow document creation requests by request_id', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_create_workflow_document',
    );
    vi.mocked(createWorkflowDocument).mockResolvedValue({
      logical_name: 'spec',
      scope: 'workflow',
      source: 'repository',
      path: 'docs/spec.md',
      metadata: {},
      created_at: '2026-03-12T00:00:00.000Z',
    });

    app = createWorkflowRoutesApp({ pgPool: pool });
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      logical_name: 'spec',
      source: 'repository',
      path: 'docs/spec.md',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/documents',
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/documents',
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(createWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(createWorkflowDocument).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      'tenant-1',
      'workflow-1',
      {
        logical_name: 'spec',
        source: 'repository',
        path: 'docs/spec.md',
      },
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow document update requests by request_id', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_update_workflow_document',
    );
    vi.mocked(updateWorkflowDocument).mockResolvedValue({
      logical_name: 'spec',
      scope: 'workflow',
      source: 'repository',
      path: 'docs/spec-v2.md',
      metadata: {},
      created_at: '2026-03-12T00:00:00.000Z',
    });

    app = createWorkflowRoutesApp({ pgPool: pool });
    await app.register(workflowRoutes);

    const payload = {
      request_id: 'request-1',
      path: 'docs/spec-v2.md',
    };
    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/documents/spec',
      payload,
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/documents/spec',
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(updateWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(updateWorkflowDocument).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      'tenant-1',
      'workflow-1',
      'spec',
      {
        path: 'docs/spec-v2.md',
      },
    );
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow document delete requests by request_id', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_delete_workflow_document',
    );
    vi.mocked(deleteWorkflowDocument).mockResolvedValue(undefined);

    app = createWorkflowRoutesApp({ pgPool: pool });
    await app.register(workflowRoutes);

    const first = await app.inject({
      method: 'DELETE',
      url: '/api/v1/workflows/workflow-1/documents/spec?request_id=request-1',
    });
    const second = await app.inject({
      method: 'DELETE',
      url: '/api/v1/workflows/workflow-1/documents/spec?request_id=request-1',
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(deleteWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(deleteWorkflowDocument).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      'tenant-1',
      'workflow-1',
      'spec',
    );
  });
});
