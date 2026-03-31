import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './api.js';
import { resetDashboardApiTestEnvironment } from './dashboard-api/create-dashboard-api.test-support.js';
import { writeSession } from './session.js';

describe('dashboard api workflow operations', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('loads workflow budget through the dashboard api surface', async () => {
    writeSession({ accessToken: 'budget-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            tokens_used: 45000,
            tokens_limit: 120000,
            cost_usd: 6.25,
            cost_limit_usd: 12.5,
            elapsed_minutes: 42,
            duration_limit_minutes: 90,
            task_count: 6,
            orchestrator_activations: 4,
            tokens_remaining: 75000,
            cost_remaining_usd: 6.25,
            time_remaining_minutes: 48,
            warning_dimensions: ['cost'],
            exceeded_dimensions: [],
            warning_threshold_ratio: 0.8,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const budget = await api.getWorkflowBudget('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/budget',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer budget-token',
        }),
      }),
    );
    expect(budget.tokens_remaining).toBe(75000);
    expect(budget.warning_dimensions).toEqual(['cost']);
  });

  it('loads workflow events through the cursor-based workflow api surface', async () => {
    writeSession({ accessToken: 'events-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 42,
              type: 'workflow.activation_started',
              entity_type: 'workflow',
              entity_id: 'workflow-1',
              actor_type: 'orchestrator',
              actor_id: 'task-1',
              data: { workflow_id: 'workflow-1', activation_id: 'activation-1' },
              created_at: '2026-03-12T12:00:00.000Z',
            },
          ],
          meta: {
            has_more: true,
            next_after: 42,
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const response = await api.listWorkflowEvents('workflow-1', {
      limit: '20',
      after: '100',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/events?limit=20&after=100',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer events-token',
        }),
      }),
    );
    expect(response).toEqual({
      data: [
        {
          id: 42,
          type: 'workflow.activation_started',
          entity_type: 'workflow',
          entity_id: 'workflow-1',
          actor_type: 'orchestrator',
          actor_id: 'task-1',
          data: { workflow_id: 'workflow-1', activation_id: 'activation-1' },
          created_at: '2026-03-12T12:00:00.000Z',
        },
      ],
      meta: {
        has_more: true,
        next_after: '42',
      },
    });
  });

  it('enqueues manual workflow activations through the dashboard api surface', async () => {
    writeSession({ accessToken: 'activation-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'activation-1',
            activation_id: 'activation-1',
            workflow_id: 'workflow-1',
            request_id: 'request-123',
            reason: 'Reassess board state',
            event_type: 'operator.manual_enqueue',
            payload: { source: 'workflow-detail-activations-card' },
            state: 'queued',
            queued_at: '2026-03-13T12:00:00.000Z',
          },
        }),
        { status: 201 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const activation = await api.enqueueWorkflowActivation('workflow-1', {
      reason: 'Reassess board state',
      payload: { source: 'workflow-detail-activations-card' },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/activations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer activation-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'request-123',
      reason: 'Reassess board state',
      event_type: 'operator.manual_enqueue',
      payload: { source: 'workflow-detail-activations-card' },
    });
    expect(activation.request_id).toBe('request-123');
    expect(activation.event_type).toBe('operator.manual_enqueue');
  });

  it('posts workflow cancellation with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'cancel-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'paused',
            metadata: { cancel_requested_at: '2026-03-13T12:00:00.000Z' },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.cancelWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'cancel-request-123',
    });
  });

  it('posts workflow pause with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'pause-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'paused',
            metadata: { pause_requested_at: '2026-03-13T12:00:00.000Z' },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.pauseWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/pause',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'pause-request-123',
    });
  });

  it('posts workflow resume with a generated request id', async () => {
    writeSession({ accessToken: 'workflow-token', tenantId: 'tenant-1' });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'resume-request-123',
    });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'workflow-1',
            state: 'active',
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    await api.resumeWorkflow('workflow-1');

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/workflows/workflow-1/resume',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer workflow-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body ?? '{}'))).toEqual({
      request_id: 'resume-request-123',
    });
  });

  it('updates playbooks through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      updatePlaybook: vi.fn().mockResolvedValue({ id: 'playbook-1', name: 'Delivery' }),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      baseUrl: 'http://localhost:8080',
    });
    const playbook = await api.updatePlaybook('playbook-1', {
      name: 'Delivery',
      outcome: 'Ship work',
      definition: { lifecycle: 'ongoing' },
    });

    expect(client.updatePlaybook).toHaveBeenCalledWith('playbook-1', {
      name: 'Delivery',
      outcome: 'Ship work',
      definition: { lifecycle: 'ongoing' },
    });
    expect(playbook).toEqual({ id: 'playbook-1', name: 'Delivery' });
  });

  it('loads and updates workflow work items through the dashboard api surface', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wi-1',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'normal',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wi-1',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'high',
              notes: 'Updated',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const client = {
      refreshSession: vi.fn(),
      setAccessToken: vi.fn(),
      listWorkflows: vi.fn(),
      exchangeApiKey: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      listTasks: vi.fn(),
      getTask: vi.fn(),
      listWorkers: vi.fn(),
      listAgents: vi.fn(),
    };

    const api = createDashboardApi({
      client: client as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });
    const workItem = await api.getWorkflowWorkItem('wf-1', 'wi-1');
    const updatedWorkItem = await api.updateWorkflowWorkItem('wf-1', 'wi-1', {
      priority: 'high',
      notes: 'Updated',
    });

    expect(workItem.id).toBe('wi-1');
    expect(updatedWorkItem.priority).toBe('high');
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/workflows/wf-1/work-items/wi-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/workflows/wf-1/work-items/wi-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
