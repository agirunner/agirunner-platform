import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowControlReplayPool,
  createWorkflowRoutesApp,
  resetWorkflowRouteAuthMocks,
  workflowRoutes,
} from './support.js';

describe('workflow routes control idempotency', () => {
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

  it('deduplicates explicit workflow chaining by request_id without duplicating parent linkage', async () => {
    const playbookId = '00000000-0000-4000-8000-000000000002';
    const createWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-child-1',
      playbook_id: playbookId,
      name: 'Follow-up Flow',
      metadata: {
        parent_workflow_id: 'workflow-1',
        chain_origin: 'explicit',
        create_request_id: 'chain-1',
      },
    });
    const getWorkflow = vi.fn(async (_tenantId: string, workflowId: string) => {
      if (workflowId === 'workflow-child-1') {
        return {
          id: 'workflow-child-1',
          playbook_id: playbookId,
          name: 'Follow-up Flow',
          metadata: {
            parent_workflow_id: 'workflow-1',
            chain_origin: 'explicit',
            create_request_id: 'chain-1',
          },
        };
      }
      return {};
    });
    let sourceMetadata: Record<string, unknown> = {};
    let existingReplayVisible = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes(
          'SELECT id, workspace_id, name, state, metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
        )
      ) {
        expect(params).toEqual(['tenant-1', 'workflow-1']);
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-1',
            name: 'Source Flow',
            workspace_id: 'workspace-1',
            state: 'active',
            metadata: sourceMetadata,
          }],
        };
      }
      if (sql.includes("metadata->>'parent_workflow_id' = $2") && sql.includes("metadata->>'create_request_id' = $3")) {
        expect(params).toEqual(['tenant-1', 'workflow-1', 'chain-1']);
        return existingReplayVisible
          ? { rowCount: 1, rows: [{ id: 'workflow-child-1' }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE workflows') && sql.includes('metadata = metadata || $3::jsonb')) {
        sourceMetadata = params?.[2] as Record<string, unknown>;
        existingReplayVisible = true;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    app = createWorkflowRoutesApp({
      workflowService: { createWorkflow, getWorkflow },
      pgPool: { query },
    });
    await app.register(workflowRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/chain',
      payload: {
        request_id: 'chain-1',
        playbook_id: playbookId,
        name: 'Follow-up Flow',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/chain',
      payload: {
        request_id: 'chain-1',
        playbook_id: playbookId,
        name: 'Follow-up Flow',
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(createWorkflow).toHaveBeenCalledTimes(1);
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: playbookId,
        workspace_id: 'workspace-1',
        name: 'Follow-up Flow',
        metadata: expect.objectContaining({
          parent_workflow_id: 'workflow-1',
          chain_origin: 'explicit',
          create_request_id: 'chain-1',
        }),
      }),
    );
    expect(getWorkflow).toHaveBeenCalledWith('tenant-1', 'workflow-child-1');
    expect(first.json().data).toEqual(expect.objectContaining({ id: 'workflow-child-1' }));
    expect(second.json().data).toEqual(expect.objectContaining({ id: 'workflow-child-1' }));
    expect(sourceMetadata.child_workflow_ids).toEqual(['workflow-child-1']);
    expect(sourceMetadata.latest_child_workflow_id).toBe('workflow-child-1');
  });

  it('deduplicates repeated workflow cancel requests by request_id at the route boundary', async () => {
    const { pool } = createWorkflowControlReplayPool('workflow-1', 'operator_cancel_workflow');
    const cancelWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      state: 'paused',
      metadata: { cancel_requested_at: '2026-03-12T00:00:00.000Z' },
    });

    app = createWorkflowRoutesApp({
      workflowService: { cancelWorkflow },
      pgPool: pool,
    });
    await app.register(workflowRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/cancel',
      payload: { request_id: 'request-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/cancel',
      payload: { request_id: 'request-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(cancelWorkflow).toHaveBeenCalledTimes(1);
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow pause requests by request_id at the route boundary', async () => {
    const { pool } = createWorkflowControlReplayPool('workflow-1', 'operator_pause_workflow');
    const pauseWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      state: 'paused',
      metadata: { pause_requested_at: '2026-03-12T00:00:00.000Z' },
    });

    app = createWorkflowRoutesApp({
      workflowService: { pauseWorkflow },
      pgPool: pool,
    });
    await app.register(workflowRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/pause',
      payload: { request_id: 'request-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/pause',
      payload: { request_id: 'request-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(pauseWorkflow).toHaveBeenCalledTimes(1);
    expect(second.json().data).toEqual(first.json().data);
  });

  it('deduplicates repeated workflow resume requests by request_id at the route boundary', async () => {
    const { pool } = createWorkflowControlReplayPool('workflow-1', 'operator_resume_workflow');
    const resumeWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      state: 'active',
    });

    app = createWorkflowRoutesApp({
      workflowService: { resumeWorkflow },
      pgPool: pool,
    });
    await app.register(workflowRoutes);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/resume',
      payload: { request_id: 'request-1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/resume',
      payload: { request_id: 'request-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(resumeWorkflow).toHaveBeenCalledTimes(1);
    expect(second.json().data).toEqual(first.json().data);
  });
});
