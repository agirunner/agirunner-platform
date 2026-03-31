import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowDocument,
  createWorkflowRoutesApp,
  deleteWorkflowDocument,
  resetWorkflowRouteAuthMocks,
  updateWorkflowDocument,
  workflowRoutes,
} from './support.js';

describe('workflow routes validation and budget', () => {
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

  it('rejects workflow work-item creation without request_id', async () => {
    const createWorkflowWorkItem = vi.fn();

    app = createWorkflowRoutesApp({
      workflowService: { createWorkflowWorkItem },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/work-items',
      payload: {
        title: 'Ship the change',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(createWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('rejects workflow work-item updates without request_id', async () => {
    const updateWorkflowWorkItem = vi.fn();

    app = createWorkflowRoutesApp({
      workflowService: { updateWorkflowWorkItem },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/work-items/work-item-1',
      payload: {
        title: 'Retitle the work item',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(updateWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it('rejects workflow chaining without request_id', async () => {
    const createWorkflow = vi.fn();

    app = createWorkflowRoutesApp({
      workflowService: {
        createWorkflow,
        getWorkflow: vi.fn(async () => ({
          id: 'workflow-1',
          workspace_id: 'workspace-1',
          metadata: {},
        })),
      },
      pgPool: {
        query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/chain',
      payload: {
        playbook_id: '00000000-0000-4000-8000-000000000002',
        name: 'Follow-up Flow',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it('rejects workflow control mutations without request_id', async () => {
    const cancelWorkflow = vi.fn();

    app = createWorkflowRoutesApp({
      workflowService: { cancelWorkflow },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/cancel',
      payload: {},
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(cancelWorkflow).not.toHaveBeenCalled();
  });

  it('rejects workflow document creation without request_id', async () => {
    app = createWorkflowRoutesApp();
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/documents',
      payload: {
        logical_name: 'spec',
        source: 'repository',
        path: 'docs/spec.md',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(createWorkflowDocument).not.toHaveBeenCalled();
  });

  it('rejects workflow document updates without request_id', async () => {
    app = createWorkflowRoutesApp();
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/documents/spec',
      payload: {
        path: 'docs/spec-v2.md',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(updateWorkflowDocument).not.toHaveBeenCalled();
  });

  it('rejects workflow document deletes without request_id', async () => {
    app = createWorkflowRoutesApp();
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/workflows/workflow-1/documents/spec',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SCHEMA_VALIDATION_FAILED');
    expect(deleteWorkflowDocument).not.toHaveBeenCalled();
  });

  it('redacts secret-bearing workflow event data in workflow-scoped browsing responses', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          type: 'workflow.activation_requeued',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          data: {
            workflow_id: 'workflow-1',
            activation_id: 'activation-1',
            api_key: 'sk-secret-value',
            credentials: {
              refresh_token: 'secret:oauth-refresh',
            },
          },
        },
      ],
      rowCount: 1,
    });

    app = createWorkflowRoutesApp({ pgPool: { query } });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/events',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        {
          id: 1,
          type: 'workflow.activation_requeued',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          data: {
            workflow_id: 'workflow-1',
            activation_id: 'activation-1',
            api_key: 'redacted://event-secret',
            credentials: {
              refresh_token: 'redacted://event-secret',
            },
          },
        },
      ],
      meta: {
        has_more: false,
        next_after: null,
      },
    });
  });

  it('exposes workflow budget reads on the public workflow API', async () => {
    const getWorkflowBudget = vi.fn().mockResolvedValue({
      tokens_used: 1200,
      tokens_limit: 5000,
      cost_usd: 1.25,
      cost_limit_usd: 10,
      elapsed_minutes: 15,
      duration_limit_minutes: 60,
      task_count: 3,
      orchestrator_activations: 2,
      tokens_remaining: 3800,
      cost_remaining_usd: 8.75,
      time_remaining_minutes: 45,
      warning_dimensions: [],
      exceeded_dimensions: [],
      warning_threshold_ratio: 0.8,
    });

    app = createWorkflowRoutesApp({
      workflowService: { getWorkflowBudget },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/budget',
    });

    expect(response.statusCode).toBe(200);
    expect(getWorkflowBudget).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(response.json().data).toEqual(
      expect.objectContaining({
        tokens_used: 1200,
        cost_usd: 1.25,
        warning_threshold_ratio: 0.8,
      }),
    );
  });
});
