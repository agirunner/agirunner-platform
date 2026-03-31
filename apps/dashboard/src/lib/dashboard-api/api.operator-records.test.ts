import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './index.js';
import { resetDashboardApiTestEnvironment } from './create-dashboard-api.test-support.js';
import { writeSession } from '../auth/session.js';

describe('dashboard api operator records', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('uses workflow operator record endpoints for mission control launch, steering, and redrive actions', async () => {
    writeSession({ accessToken: 'operator-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn() as unknown as typeof fetch;
    vi
      .mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'packet-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                packet_kind: 'launch',
                source: 'operator',
                summary: 'Launch files',
                structured_inputs: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
                files: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'packet-2',
              workflow_id: 'workflow-1',
              work_item_id: null,
              packet_kind: 'launch',
              source: 'operator',
              summary: 'Launch files',
              structured_inputs: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
              files: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'intervention-1',
                workflow_id: 'workflow-1',
                work_item_id: null,
                task_id: null,
                kind: 'steering_instruction',
                origin: 'mission_control',
                status: 'recorded',
                summary: 'Focus on verification',
                note: null,
                structured_action: {},
                metadata: {},
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
                files: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'intervention-2',
              workflow_id: 'workflow-1',
              work_item_id: null,
              task_id: null,
              kind: 'steering_instruction',
              origin: 'mission_control',
              status: 'recorded',
              summary: 'Focus on verification',
              note: null,
              structured_action: {},
              metadata: {},
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
              files: [],
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'session-1',
                workflow_id: 'workflow-1',
                title: 'Operator steering',
                status: 'active',
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
                updated_at: '2026-03-27T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'session-2',
              workflow_id: 'workflow-1',
              title: 'Operator steering',
              status: 'active',
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
              updated_at: '2026-03-27T00:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'message-1',
                workflow_id: 'workflow-1',
                steering_session_id: 'session-1',
                role: 'operator',
                content: 'Focus on verification',
                structured_proposal: {},
                intervention_id: null,
                created_by_type: 'user',
                created_by_id: 'user-1',
                created_at: '2026-03-27T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'message-2',
              workflow_id: 'workflow-1',
              steering_session_id: 'session-1',
              role: 'operator',
              content: 'Focus on verification',
              structured_proposal: {},
              intervention_id: null,
              created_by_type: 'user',
              created_by_id: 'user-1',
              created_at: '2026-03-27T00:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              source_workflow_id: 'workflow-1',
              attempt_number: 2,
              workflow: {
                id: 'workflow-2',
                name: 'Release retry',
              },
              input_packet: null,
            },
          }),
          { status: 201 },
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

    const packets = await api.listWorkflowInputPackets('workflow-1');
    const createdPacket = await api.createWorkflowInputPacket('workflow-1', {
      packet_kind: 'launch',
      summary: 'Launch files',
      files: [],
    });
    const interventions = await api.listWorkflowInterventions('workflow-1');
    const createdIntervention = await api.createWorkflowIntervention('workflow-1', {
      kind: 'steering_instruction',
      summary: 'Focus on verification',
    });
    const sessions = await api.listWorkflowSteeringSessions('workflow-1');
    const createdSession = await api.createWorkflowSteeringSession('workflow-1', {
      title: 'Operator steering',
    });
    const messages = await api.listWorkflowSteeringMessages('workflow-1', 'session-1');
    const appendedMessage = await api.appendWorkflowSteeringMessage('workflow-1', 'session-1', {
      content: 'Focus on verification',
    });
    const redrive = await api.redriveWorkflow('workflow-1', {
      request_id: 'request-1',
      name: 'Release retry',
      summary: 'Retry with corrected inputs',
    });

    expect(packets[0].id).toBe('packet-1');
    expect(createdPacket.id).toBe('packet-2');
    expect(interventions[0].id).toBe('intervention-1');
    expect(createdIntervention.id).toBe('intervention-2');
    expect(sessions[0].id).toBe('session-1');
    expect(createdSession.id).toBe('session-2');
    expect(messages[0].id).toBe('message-1');
    expect(appendedMessage.id).toBe('message-2');
    expect(redrive.workflow.id).toBe('workflow-2');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/input-packets',
    );
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/input-packets',
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/interventions',
    );
    expect(vi.mocked(fetcher).mock.calls[3][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/interventions',
    );
    expect(vi.mocked(fetcher).mock.calls[4][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions',
    );
    expect(vi.mocked(fetcher).mock.calls[5][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions',
    );
    expect(vi.mocked(fetcher).mock.calls[6][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions/session-1/messages',
    );
    expect(vi.mocked(fetcher).mock.calls[7][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/steering-sessions/session-1/messages',
    );
    expect(vi.mocked(fetcher).mock.calls[8][0]).toBe(
      'http://localhost:8080/api/v1/workflows/workflow-1/redrives',
    );
  });

  it('uses persisted platform instruction endpoints for current state, versions, restore, and clear', async () => {
    writeSession({ accessToken: 'api-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 3, content: '# Current', format: 'markdown' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'ver-2', version: 2, content: '# Older', format: 'markdown' }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 4, content: '# Restored', format: 'markdown' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { version: 5, content: '', format: 'text' },
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

    await expect(api.getPlatformInstructions()).resolves.toMatchObject({ version: 3 });
    await expect(api.listPlatformInstructionVersions()).resolves.toMatchObject([{ version: 2 }]);
    await expect(
      api.updatePlatformInstructions({ content: '# Restored', format: 'markdown' }),
    ).resolves.toMatchObject({ version: 4 });
    await expect(api.clearPlatformInstructions()).resolves.toMatchObject({
      version: 5,
      content: '',
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({ Authorization: 'Bearer api-token' }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v1/platform/instructions/versions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v1/platform/instructions',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    );
  });
});
