import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTransactionalWorkflowReplayPool,
  createWorkflowRoutesApp,
  resetWorkflowRouteAuthMocks,
  workflowRoutes,
} from './support.js';

describe('workflow routes events and work items', () => {
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

  it('exposes workflow-scoped event browsing with workflow entity fallback filtering', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 101,
          type: 'workflow.activation_requeued',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          data: {
            activation_id: 'activation-1',
            stage_name: 'implementation',
          },
        },
      ],
      rowCount: 1,
    });

    app = createWorkflowRoutesApp({ pgPool: { query } });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/events?activation_id=activation-1&stage_name=implementation&types=workflow.activation_requeued&after=120&limit=5',
    });

    expect(response.statusCode).toBe(200);
    const [selectSql, selectParams] = query.mock.calls[0];
    expect(selectSql).toContain(
      "(entity_id::text = $2 OR COALESCE(data->>'workflow_id', CASE WHEN entity_type = 'workflow' THEN entity_id::text ELSE '' END) = $2)",
    );
    expect(selectSql).toContain("COALESCE(data->>'activation_id', '') = $");
    expect(selectSql).toContain("COALESCE(data->>'stage_name', '') = $");
    expect(selectSql).toContain('type = ANY(');
    expect(selectSql).toContain('id < $');
    expect(selectSql).toContain('ORDER BY id DESC');
    expect(selectParams).toEqual([
      'tenant-1',
      'workflow-1',
      'implementation',
      'activation-1',
      ['workflow.activation_requeued'],
      120,
      6,
    ]);
    expect(response.json()).toEqual({
      data: [
        {
          id: 101,
          type: 'workflow.activation_requeued',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          data: {
            activation_id: 'activation-1',
            stage_name: 'implementation',
          },
        },
      ],
      meta: {
        has_more: false,
        next_after: null,
      },
    });
  });

  it('accepts per_page as an alias for limit on workflow-scoped event browsing', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });

    app = createWorkflowRoutesApp({ pgPool: { query } });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/events?per_page=25',
    });

    expect(response.statusCode).toBe(200);
    const [, selectParams] = query.mock.calls[0];
    expect(selectParams.at(-1)).toBe(26);
  });

  it('accepts per_page as an alias for limit on workflow work-item event browsing', async () => {
    const listWorkflowWorkItemEvents = vi.fn(async () => []);

    app = createWorkflowRoutesApp({
      workflowService: { listWorkflowWorkItemEvents },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/work-items/work-item-1/events?per_page=25',
    });

    expect(response.statusCode).toBe(200);
    expect(listWorkflowWorkItemEvents).toHaveBeenCalledWith('tenant-1', 'workflow-1', 'work-item-1', 25);
  });

  it('accepts workflow work-item creation when request_id is provided', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_create_workflow_work_item',
    );
    const createWorkflowWorkItem = vi.fn(async () => ({
      id: 'work-item-1',
      workflow_id: 'workflow-1',
      title: 'Ship the change',
    }));

    app = createWorkflowRoutesApp({
      pgPool: pool,
      workflowService: { createWorkflowWorkItem },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      payload: {
        request_id: 'request-1',
        title: 'Ship the change',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'request-1',
        title: 'Ship the change',
      }),
      expect.objectContaining({ query: expect.any(Function) }),
    );
  });

  it('forwards optional initial input packets with workflow work-item creation', async () => {
    const { pool } = createTransactionalWorkflowReplayPool(
      'workflow-1',
      'operator_create_workflow_work_item',
    );
    const createWorkflowWorkItem = vi.fn(async () => ({
      id: 'work-item-1',
      workflow_id: 'workflow-1',
      title: 'Ship the change',
    }));

    app = createWorkflowRoutesApp({
      pgPool: pool,
      workflowService: { createWorkflowWorkItem },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      payload: {
        request_id: 'request-1',
        title: 'Ship the change',
        initial_input_packet: {
          summary: 'Operator packet',
          structured_inputs: {
            prompt: 'Tell me a joke',
          },
          files: [
            {
              file_name: 'prompt.txt',
              content_base64: Buffer.from('Tell me a joke').toString('base64'),
              content_type: 'text/plain',
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'request-1',
        title: 'Ship the change',
        initial_input_packet: expect.objectContaining({
          summary: 'Operator packet',
          structured_inputs: {
            prompt: 'Tell me a joke',
          },
          files: [
            expect.objectContaining({
              fileName: 'prompt.txt',
              contentBase64: Buffer.from('Tell me a joke').toString('base64'),
              contentType: 'text/plain',
            }),
          ],
        }),
      }),
      expect.objectContaining({ query: expect.any(Function) }),
    );
  });
});
