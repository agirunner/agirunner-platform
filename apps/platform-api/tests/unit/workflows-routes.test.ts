import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowDocument,
  deleteWorkflowDocument,
  updateWorkflowDocument,
} from '../../src/services/document-reference-service.js';
import { registerErrorHandler } from '../../src/errors/error-handler.js';
import { workflowRoutes } from '../../src/api/routes/workflows.routes.js';

const mockWithAllowedScopes = vi.fn((_scopes: string[]) => async () => {});
const mockWithScope = vi.fn((_scope: string) => async () => {});

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: 'agent-1',
      keyPrefix: 'agent-1',
    };
  },
  withAllowedScopes: (scopes: string[]) => mockWithAllowedScopes(scopes),
  withScope: (scope: string) => mockWithScope(scope),
}));

vi.mock('../../src/services/document-reference-service.js', () => ({
  createWorkflowDocument: vi.fn(),
  deleteWorkflowDocument: vi.fn(),
  listWorkflowDocuments: vi.fn(async () => []),
  updateWorkflowDocument: vi.fn(),
}));

function createWorkflowControlReplayPool(
  workflowId: string,
  toolName: string,
) {
  let storedResponse: Record<string, unknown> | null = null;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, 'request-1']);
        return storedResponse
          ? { rowCount: 1, rows: [{ response: storedResponse }] }
          : { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected client query: ${sql}`);
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        storedResponse = params?.[4] as Record<string, unknown>;
        return { rowCount: 1, rows: [{ response: storedResponse }] };
      }
      throw new Error(`unexpected pool query: ${sql}`);
    }),
  };

  return { pool, client };
}

function createTransactionalWorkflowReplayPool(
  workflowId: string,
  toolName: string,
) {
  let storedResponse: Record<string, unknown> | null = null;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT response') && sql.includes('workflow_tool_results')) {
        expect(params).toEqual(['tenant-1', workflowId, toolName, 'request-1']);
        return storedResponse
          ? { rowCount: 1, rows: [{ response: storedResponse }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO workflow_tool_results')) {
        storedResponse = params?.[4] as Record<string, unknown>;
        return { rowCount: 1, rows: [{ response: storedResponse }] };
      }
      throw new Error(`unexpected client query: ${sql}`);
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => {
      throw new Error('unexpected pool query');
    }),
  };

  return { pool, client };
}

function createWorkflowRoutesApp(overrides?: {
  workflowService?: Record<string, unknown>;
  workflowInputPacketService?: Record<string, unknown>;
  workflowOperatorBriefService?: Record<string, unknown>;
  workflowOperatorUpdateService?: Record<string, unknown>;
  workflowInterventionService?: Record<string, unknown>;
  workflowSteeringSessionService?: Record<string, unknown>;
  workflowRedriveService?: Record<string, unknown>;
  workflowSettingsService?: Record<string, unknown>;
  pgPool?: Record<string, unknown>;
}) {
  const routeApp = fastify();
  registerErrorHandler(routeApp);
  routeApp.decorate(
    'workflowService',
    {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
      ...(overrides?.workflowService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'pgPool',
    ((overrides?.pgPool as Record<string, unknown> | undefined) ?? {
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      connect: vi.fn(async () => ({
        query: vi.fn(async () => {
          throw new Error('unexpected pgPool.connect query');
        }),
        release: vi.fn(),
      })),
    }) as never,
  );
  routeApp.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 } as never);
  routeApp.decorate('eventService', { emit: async () => undefined } as never);
  routeApp.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) } as never);
  routeApp.decorate(
    'workflowInputPacketService',
    {
      listWorkflowInputPackets: async () => [],
      createWorkflowInputPacket: async () => ({}),
      downloadWorkflowInputPacketFile: async () => ({
        file: { file_name: 'file.txt' },
        contentType: 'text/plain',
        data: Buffer.from('file'),
      }),
      ...(overrides?.workflowInputPacketService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowOperatorBriefService',
    {
      listBriefs: async () => [],
      recordBriefWrite: async () => ({}),
      ...(overrides?.workflowOperatorBriefService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowOperatorUpdateService',
    {
      listUpdates: async () => [],
      recordUpdateWrite: async () => ({}),
      ...(overrides?.workflowOperatorUpdateService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowInterventionService',
    {
      listWorkflowInterventions: async () => [],
      recordIntervention: async () => ({}),
      downloadWorkflowInterventionFile: async () => ({
        file: { file_name: 'file.txt' },
        contentType: 'text/plain',
        data: Buffer.from('file'),
      }),
      ...(overrides?.workflowInterventionService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowSteeringSessionService',
    {
      listSessions: async () => [],
      createSession: async () => ({}),
      listMessages: async () => [],
      appendMessage: async () => ({}),
      recordSteeringRequest: async () => ({}),
      ...(overrides?.workflowSteeringSessionService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowRedriveService',
    {
      redriveWorkflow: async () => ({}),
      ...(overrides?.workflowRedriveService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'workflowSettingsService',
    {
      getWorkflowSettings: async () => ({}),
      updateWorkflowSettings: async () => ({}),
      ...(overrides?.workflowSettingsService ?? {}),
    } as never,
  );
  routeApp.decorate(
    'modelCatalogService',
    {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    } as never,
  );
  return routeApp;
}

describe('workflow routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    mockWithAllowedScopes.mockImplementation(() => async () => {});
    mockWithScope.mockImplementation(() => async () => {});
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    vi.clearAllMocks();
  });

  it('does not register the removed manual-rework route', async () => {
    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', {});
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
    await app.register(workflowRoutes);

    const routes = app.printRoutes();

    expect(routes).not.toContain('/api/v1/workflows/:id/manual-rework');
    expect(routes).toContain('├── tasks (GET, HEAD)');
    expect(routes).toContain('├── events (GET, HEAD)');
  });

  it('lists workflow input packets through workflow-owned routes', async () => {
    const listWorkflowInputPackets = vi.fn().mockResolvedValue([
      {
        id: 'packet-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
        packet_kind: 'supplemental',
        source: 'operator',
        summary: 'Added a deployment checklist',
        structured_inputs: { environment: 'staging' },
        metadata: {},
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
        files: [],
      },
    ]);

    app = createWorkflowRoutesApp({
      workflowInputPacketService: { listWorkflowInputPackets },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/input-packets',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listWorkflowInputPackets).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(response.json().data[0]).toEqual(
      expect.objectContaining({
        id: 'packet-1',
        packet_kind: 'supplemental',
      }),
    );
  });

  it('records workflow interventions with attachments through workflow-owned routes', async () => {
    const recordIntervention = vi.fn().mockResolvedValue({
      id: 'intervention-1',
      workflow_id: 'workflow-1',
      work_item_id: '00000000-0000-0000-0000-000000000201',
      task_id: '00000000-0000-0000-0000-000000000301',
      kind: 'task_action',
      origin: 'operator',
      status: 'applied',
      summary: 'Retry the failed verification task',
      note: 'Use the attached checklist first.',
      structured_action: { kind: 'retry_task', task_id: 'task-1' },
      metadata: {},
      created_by_type: 'user',
      created_by_id: 'user-1',
      created_at: '2026-03-27T10:05:00.000Z',
      updated_at: '2026-03-27T10:05:00.000Z',
      files: [],
    });

    app = createWorkflowRoutesApp({
      workflowInterventionService: { recordIntervention },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/interventions',
      headers: { authorization: 'Bearer test' },
      payload: {
        kind: 'task_action',
        summary: 'Retry the failed verification task',
        note: 'Use the attached checklist first.',
        work_item_id: '00000000-0000-0000-0000-000000000201',
        task_id: '00000000-0000-0000-0000-000000000301',
        structured_action: { kind: 'retry_task', task_id: '00000000-0000-0000-0000-000000000301' },
        files: [
          {
            file_name: 'checklist.txt',
            content_base64: Buffer.from('checklist').toString('base64'),
            content_type: 'text/plain',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        kind: 'task_action',
        workItemId: '00000000-0000-0000-0000-000000000201',
        taskId: '00000000-0000-0000-0000-000000000301',
      }),
    );
  });

  it('lists and records workflow operator briefs through workflow-owned routes', async () => {
    const listBriefs = vi.fn().mockResolvedValue([
      {
        id: 'brief-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
        task_id: null,
        request_id: 'request-1',
        execution_context_id: 'execution-1',
        brief_kind: 'milestone',
        brief_scope: 'workflow_timeline',
        source_kind: 'orchestrator',
        source_role_name: 'Orchestrator',
        status_kind: 'in_progress',
        short_brief: { headline: 'Release package is ready for approval.' },
        detailed_brief_json: { headline: 'Release package is ready for approval.' },
        sequence_number: 4,
        related_artifact_ids: [],
        related_output_descriptor_ids: [],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
      },
    ]);
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-2',
      sequence_number: 5,
      deduped: false,
      record: {
        id: 'brief-2',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Verification completed.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs,
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const headers = { authorization: 'Bearer test' };
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/operator-briefs?limit=10',
      headers,
    });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers,
      payload: {
        request_id: 'request-2',
        execution_context_id: 'execution-2',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'workflow_timeline',
        source_kind: 'orchestrator',
        source_role_name: 'Orchestrator',
        status_kind: 'in_progress',
        payload: {
          short_brief: {
            headline: 'Verification completed.',
          },
          detailed_brief_json: {
            headline: 'Verification completed.',
            status_kind: 'in_progress',
          },
          linked_deliverables: [
            {
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Release bundle',
              state: 'final',
              primary_target: {
                target_kind: 'artifact',
                label: 'Download release bundle',
                url: 'https://example.invalid/bundle.zip',
              },
            },
          ],
          linked_target_ids: ['target-1'],
        },
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(listBriefs).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: undefined,
      limit: 10,
    });
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-2',
        executionContextId: 'execution-2',
        briefKind: 'milestone',
        payload: expect.objectContaining({
          linkedTargetIds: ['target-1'],
        }),
      }),
    );
  });

  it('accepts operator brief route writes without a duplicate top-level status_kind field', async () => {
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-3',
      sequence_number: 6,
      deduped: false,
      record: {
        id: 'brief-3',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Verification completed.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs: vi.fn().mockResolvedValue([]),
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-3',
        execution_context_id: 'execution-3',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'workflow_timeline',
        source_kind: 'orchestrator',
        payload: {
          short_brief: {
            headline: 'Verification completed.',
          },
          detailed_brief_json: {
            headline: 'Verification completed.',
            status_kind: 'in_progress',
          },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-3',
        executionContextId: 'execution-3',
        statusKind: undefined,
      }),
    );
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

  it('passes request and initial launch packet inputs through workflow creation routes', async () => {
    const createWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      name: 'Release workflow',
      live_visibility_mode_override: 'enhanced',
    });

    app = createWorkflowRoutesApp({
      workflowService: { createWorkflow },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-1',
        playbook_id: '00000000-0000-4000-8000-000000000002',
        name: 'Release workflow',
        operator_note: 'Prioritize the verification branch first.',
        initial_input_packet: {
          summary: 'Launch packet summary',
          structured_inputs: { ticket: 'INC-42' },
        },
        live_visibility_mode: 'enhanced',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        request_id: 'request-1',
        operator_note: 'Prioritize the verification branch first.',
        initial_input_packet: {
          summary: 'Launch packet summary',
          structured_inputs: { ticket: 'INC-42' },
        },
        live_visibility_mode: 'enhanced',
      }),
    );
  });

  it('passes live visibility mode through workflow creation routes', async () => {
    const createWorkflow = vi.fn().mockResolvedValue({
      id: 'workflow-1',
      name: 'Release workflow',
      live_visibility_mode_override: 'enhanced',
    });

    app = createWorkflowRoutesApp({
      workflowService: { createWorkflow },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: 'Bearer test' },
      payload: {
        playbook_id: '00000000-0000-4000-8000-000000000002',
        name: 'Release workflow',
        live_visibility_mode: 'enhanced',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.objectContaining({
        playbook_id: '00000000-0000-4000-8000-000000000002',
        name: 'Release workflow',
        live_visibility_mode: 'enhanced',
      }),
    );
  });

  it('reads and updates workflow live visibility settings through workflow-owned routes', async () => {
    const getWorkflowSettings = vi.fn().mockResolvedValue({
      workflow_id: 'workflow-1',
      effective_live_visibility_mode: 'enhanced',
      workflow_live_visibility_mode_override: null,
      source: 'agentic_settings',
      revision: 2,
      updated_by_operator_id: 'user-1',
      updated_at: '2026-03-27T23:00:00.000Z',
    });
    const updateWorkflowSettings = vi.fn().mockResolvedValue({
      workflow_id: 'workflow-1',
      effective_live_visibility_mode: 'standard',
      workflow_live_visibility_mode_override: 'standard',
      source: 'workflow_override',
      revision: 3,
      updated_by_operator_id: 'user-1',
      updated_at: '2026-03-27T23:10:00.000Z',
    });

    app = createWorkflowRoutesApp({
      workflowSettingsService: {
        getWorkflowSettings,
        updateWorkflowSettings,
      },
    });
    await app.register(workflowRoutes);

    const headers = { authorization: 'Bearer test' };
    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/settings',
      headers,
    });
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/workflows/workflow-1/settings',
      headers,
      payload: {
        live_visibility_mode: 'standard',
        settings_revision: 2,
      },
    });

    expect(getResponse.statusCode).toBe(200);
    expect(patchResponse.statusCode).toBe(200);
    expect(getWorkflowSettings).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(updateWorkflowSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      {
        liveVisibilityMode: 'standard',
        settingsRevision: 2,
      },
    );
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', { query });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', { query });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents,
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', { query: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', { query });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget,
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', { query: vi.fn() });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow,
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow,
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', { query });
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow,
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow,
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow,
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
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

    app = fastify();
    app.decorate('workflowService', {
      createWorkflow: async () => ({}),
      listWorkflows: async () => ({ data: [], meta: {} }),
      getWorkflow: async () => ({}),
      getWorkflowBudget: async () => ({}),
      getWorkflowBoard: async () => ({}),
      listWorkflowStages: async () => ([]),
      listWorkflowWorkItems: async () => ([]),
      createWorkflowWorkItem: async () => ({}),
      getWorkflowWorkItem: async () => ({}),
      listWorkflowWorkItemTasks: async () => ([]),
      listWorkflowWorkItemEvents: async () => ([]),
      getWorkflowWorkItemMemory: async () => ({ entries: [] }),
      getWorkflowWorkItemMemoryHistory: async () => ({ history: [] }),
      updateWorkflowWorkItem: async () => ({}),
      actOnStageGate: async () => ({}),
      getResolvedConfig: async () => ({}),
      cancelWorkflow: async () => ({}),
      pauseWorkflow: async () => ({}),
      resumeWorkflow: async () => ({}),
      deleteWorkflow: async () => ({}),
    });
    app.decorate('pgPool', pool);
    app.decorate('config', { TASK_DEFAULT_TIMEOUT_MINUTES: 30 });
    app.decorate('eventService', { emit: async () => undefined });
    app.decorate('workspaceService', { getWorkspace: async () => ({ settings: {} }) });
    app.decorate('modelCatalogService', {
      resolveRoleConfig: async () => null,
      listProviders: async () => [],
      listModels: async () => [],
      getProviderForOperations: async () => null,
    });
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
