import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowRoutesApp,
  mockWithAllowedScopes,
  resetWorkflowRouteAuthMocks,
  workflowRoutes,
} from './support.js';

describe('workflow routes operator updates and redrive', () => {
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

  it('registers operator record writes with both admin and agent scopes', async () => {
    app = createWorkflowRoutesApp();
    await app.register(workflowRoutes);

    expect(mockWithAllowedScopes).toHaveBeenCalledWith(['admin', 'worker', 'agent']);
  });

  it('lists and records workflow operator updates through workflow-owned routes', async () => {
    const listUpdates = vi.fn().mockResolvedValue([
      {
        id: 'update-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
        task_id: null,
        request_id: 'request-1',
        execution_context_id: 'execution-1',
        source_kind: 'orchestrator',
        source_role_name: 'Orchestrator',
        update_kind: 'turn_update',
        headline: 'Implementation is running validation.',
        summary: 'Verification started.',
        linked_target_ids: [],
        visibility_mode: 'enhanced',
        promoted_brief_id: null,
        sequence_number: 9,
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T10:05:00.000Z',
      },
    ]);
    const recordUpdateWrite = vi.fn().mockResolvedValue({
      record_id: 'update-2',
      sequence_number: 10,
      deduped: false,
      record: {
        id: 'update-2',
        workflow_id: 'workflow-1',
        headline: 'Verification is reviewing rollback handling.',
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorUpdateService: {
        listUpdates,
        recordUpdateWrite,
      },
    });
    await app.register(workflowRoutes);

    const headers = { authorization: 'Bearer test' };
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/operator-updates?limit=5',
      headers,
    });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-updates',
      headers,
      payload: {
        request_id: 'request-2',
        execution_context_id: 'execution-2',
        workflow_id: 'workflow-1',
        source_kind: 'specialist',
        source_role_name: 'Verifier',
        payload: {
          update_kind: 'turn_update',
          headline: 'Verification is reviewing rollback handling.',
          summary: 'Verification is in progress.',
          linked_target_ids: ['task-1'],
        },
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(listUpdates).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: undefined,
      limit: 5,
    });
    expect(recordUpdateWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-2',
        executionContextId: 'execution-2',
        payload: expect.objectContaining({
          updateKind: 'turn_update',
          linkedTargetIds: ['task-1'],
        }),
      }),
    );
  });

  it('accepts operator update route writes when runtime-derived fields are omitted', async () => {
    const recordUpdateWrite = vi.fn().mockResolvedValue({
      record_id: 'update-3',
      sequence_number: 11,
      deduped: false,
      record: {
        id: 'update-3',
        workflow_id: 'workflow-1',
        headline: 'Verification is reviewing rollback handling.',
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorUpdateService: {
        listUpdates: vi.fn().mockResolvedValue([]),
        recordUpdateWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-updates',
      headers: { authorization: 'Bearer test' },
      payload: {
        execution_context_id: 'execution-3',
        workflow_id: 'workflow-1',
        payload: {
          headline: 'Verification is reviewing rollback handling.',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordUpdateWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: undefined,
        executionContextId: 'execution-3',
        sourceKind: undefined,
        payload: expect.objectContaining({
          updateKind: undefined,
          headline: 'Verification is reviewing rollback handling.',
        }),
      }),
    );
  });

  it('falls back to task_id as the execution context when operator record routes omit execution_context_id', async () => {
    const recordUpdateWrite = vi.fn().mockResolvedValue({
      record_id: 'update-4',
      sequence_number: 12,
      deduped: false,
      record: {
        id: 'update-4',
        workflow_id: 'workflow-1',
        headline: 'Verification is reviewing rollback handling.',
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorUpdateService: {
        listUpdates: vi.fn().mockResolvedValue([]),
        recordUpdateWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-updates',
      headers: { authorization: 'Bearer test' },
      payload: {
        workflow_id: 'workflow-1',
        task_id: '00000000-0000-0000-0000-000000000301',
        payload: {
          headline: 'Verification is reviewing rollback handling.',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordUpdateWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        executionContextId: '00000000-0000-0000-0000-000000000301',
        taskId: '00000000-0000-0000-0000-000000000301',
      }),
    );
  });

  it('records steering requests through the canonical workflow-owned route and preserves session history reads', async () => {
    const listSessions = vi.fn().mockResolvedValue([
      {
        id: 'session-1',
        workflow_id: 'workflow-1',
        work_item_id: '11111111-1111-4111-8111-111111111111',
        title: 'Recovery session',
        status: 'open',
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:10:00.000Z',
        last_message_at: '2026-03-27T10:10:00.000Z',
      },
    ]);
    const listMessages = vi.fn().mockResolvedValue([
      {
        id: 'message-1',
        workflow_id: 'workflow-1',
        work_item_id: '11111111-1111-4111-8111-111111111111',
        steering_session_id: 'session-1',
        source_kind: 'operator',
        message_kind: 'operator_request',
        headline: 'Focus on getting this workflow unblocked today.',
        body: null,
        linked_intervention_id: null,
        linked_input_packet_id: null,
        linked_operator_update_id: null,
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T10:10:00.000Z',
      },
      {
        id: 'message-2',
        workflow_id: 'workflow-1',
        work_item_id: '11111111-1111-4111-8111-111111111111',
        steering_session_id: 'session-1',
        source_kind: 'platform',
        message_kind: 'steering_response',
        headline: 'Steering request recorded',
        body: 'The workflow steering history now includes this request.',
        linked_intervention_id: null,
        linked_input_packet_id: '22222222-2222-4222-8222-222222222222',
        linked_operator_update_id: null,
        created_by_type: 'system',
        created_by_id: 'platform',
        created_at: '2026-03-27T10:10:01.000Z',
      },
    ]);
    const recordSteeringRequest = vi.fn().mockResolvedValue({
      outcome: 'applied',
      result_kind: 'steering_request_recorded',
      source_workflow_id: 'workflow-1',
      workflow_id: 'workflow-1',
      resulting_work_item_id: '11111111-1111-4111-8111-111111111111',
      input_packet_id: null,
      intervention_id: null,
      snapshot_version: null,
      settings_revision: null,
      message: 'Steering request recorded.',
      redrive_lineage: null,
      steering_session_id: 'session-1',
      request_message_id: 'message-1',
      response_message_id: 'message-2',
      linked_intervention_ids: [],
      linked_input_packet_ids: ['22222222-2222-4222-8222-222222222222'],
    });

    app = createWorkflowRoutesApp({
      workflowSteeringSessionService: {
        listSessions,
        listMessages,
        recordSteeringRequest,
      },
    });
    await app.register(workflowRoutes);

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/steering-requests',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-3',
        request: 'Focus on getting this workflow unblocked today.',
        work_item_id: '11111111-1111-4111-8111-111111111111',
        linked_input_packet_ids: ['22222222-2222-4222-8222-222222222222'],
      },
    });

    expect(requestResponse.statusCode).toBe(201);
    expect(recordSteeringRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-3',
        request: 'Focus on getting this workflow unblocked today.',
        workItemId: '11111111-1111-4111-8111-111111111111',
        linkedInputPacketIds: ['22222222-2222-4222-8222-222222222222'],
      }),
    );

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/steering-sessions',
      headers: { authorization: 'Bearer test' },
    });
    const messagesResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/steering-sessions/session-1/messages',
      headers: { authorization: 'Bearer test' },
    });

    expect(sessionsResponse.statusCode).toBe(200);
    expect(messagesResponse.statusCode).toBe(200);
    expect(listSessions).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(listMessages).toHaveBeenCalledWith('tenant-1', 'workflow-1', 'session-1');
  });

  it('creates linked workflow attempts through the redrive route', async () => {
    const redriveWorkflow = vi.fn().mockResolvedValue({
      source_workflow_id: 'workflow-1',
      attempt_number: 2,
      redrive_lineage: {
        attempt_group_id: 'attempt-group-1',
        attempt_number: 2,
      },
      workflow: {
        id: 'workflow-2',
        name: 'Release workflow retry',
      },
      input_packet: null,
    });

    app = createWorkflowRoutesApp({
      workflowRedriveService: { redriveWorkflow },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/redrives',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-1',
        name: 'Release workflow retry',
        reason: 'Verification failed after stale rollback instructions.',
        summary: 'Retry with corrected deployment inputs',
        steering_instruction: 'Focus on the verification path first.',
        redrive_input_packet_id: '11111111-1111-4111-8111-111111111111',
        inheritance_policy: 'inherit_all',
        parameters: { target: 'staging' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(redriveWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-1',
        name: 'Release workflow retry',
        reason: 'Verification failed after stale rollback instructions.',
        summary: 'Retry with corrected deployment inputs',
        steeringInstruction: 'Focus on the verification path first.',
        redriveInputPacketId: '11111111-1111-4111-8111-111111111111',
        inheritancePolicy: 'inherit_all',
        parameters: { target: 'staging' },
      }),
    );
  });
});
