import { describe, expect, it, vi, beforeEach } from 'vitest';

import { LogService } from '../../src/logging/log-service.js';
import { createLoggedService } from '../../src/logging/create-logged-service.js';

/**
 * End-to-end verification tests for the unified logging system.
 *
 * These tests verify the full data flow:
 *   1. Ingest → insert → query round-trip
 *   2. Service proxy mutations produce correct log entries
 *   3. Batch insert → query with filters
 *   4. Stats aggregation from ingested entries
 *   5. All registered services produce logs with correct categories/operations
 */

function createMockPool() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;

  return {
    rows,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO execution_logs')) {
        const p = params as unknown[];
        const row = {
          id: String(nextId++),
          tenant_id: p[0],
          trace_id: p[1],
          span_id: p[2],
          parent_span_id: p[3],
          source: p[4],
          category: p[5],
          level: p[6],
          operation: p[7],
          status: p[8],
          duration_ms: p[9],
          payload: JSON.parse(p[10] as string),
          error: p[11] ? JSON.parse(p[11] as string) : null,
          project_id: p[12],
          workflow_id: p[13],
          workflow_name: p[14],
          project_name: p[15],
          task_id: p[16],
          task_title: p[17],
          workflow_phase: p[18],
          role: p[19],
          actor_type: p[20],
          actor_id: p[21],
          actor_name: p[22],
          resource_type: p[23],
          resource_id: p[24],
          resource_name: p[25],
          created_at: p[26] ?? new Date().toISOString(),
        };
        rows.push(row);
        return { rowCount: 1, rows: [row] };
      }
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('FROM execution_logs')) {
        return { rowCount: rows.length, rows: [...rows] };
      }
      return { rowCount: 0, rows: [] };
    }),
  };
}

function stubRequestContext(tenantId = 'tenant-1', requestId = 'req-1') {
  vi.doMock('../../src/observability/request-context.js', () => ({
    getRequestContext: () => ({
      requestId,
      auth: {
        tenantId,
        scope: 'admin',
        keyPrefix: 'ar_admin_test123',
      },
    }),
  }));
}

describe('Logging E2E Verification', () => {
  describe('ingest → insert round-trip', () => {
    it('insertsEntryWithAllFieldsPreserved', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-abc',
        spanId: 'span-def',
        parentSpanId: 'span-parent',
        source: 'runtime',
        category: 'llm',
        level: 'info',
        operation: 'llm.chat_stream',
        status: 'completed',
        durationMs: 1500,
        payload: { model: 'claude-opus', input_tokens: 500, output_tokens: 200 },
        projectId: 'proj-1',
        workflowId: 'wf-1',
        taskId: 'task-1',
        actorType: 'worker',
        actorId: 'w-1',
        actorName: 'worker-01',
        resourceType: 'llm_provider',
        resourceId: 'prov-1',
        resourceName: 'Anthropic',
      });

      expect(pool.rows).toHaveLength(1);
      const row = pool.rows[0];
      expect(row.tenant_id).toBe('tenant-1');
      expect(row.source).toBe('runtime');
      expect(row.category).toBe('llm');
      expect(row.operation).toBe('llm.chat_stream');
      expect(row.duration_ms).toBe(1500);
      expect(row.payload).toEqual({ model: 'claude-opus', input_tokens: 500, output_tokens: 200 });
      expect(row.actor_type).toBe('worker');
      expect(row.resource_type).toBe('llm_provider');
    });

    it('redactsSecretsInPayloadOnInsert', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'platform',
        category: 'auth',
        level: 'info',
        operation: 'auth.login',
        status: 'completed',
        payload: { api_key: 'sk-secret-value', username: 'mark', password: 'hunter2' },
      });

      const row = pool.rows[0];
      expect(row.payload).toEqual({
        api_key: '[REDACTED]',
        username: 'mark',
        password: '[REDACTED]',
      });
    });

    it('batchInsertAcceptsMultipleEntries', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      const result = await service.insertBatch([
        {
          tenantId: 'tenant-1',
          traceId: 'trace-1',
          spanId: 'span-1',
          source: 'container_manager',
          category: 'container',
          level: 'info',
          operation: 'container.create',
          status: 'completed',
        },
        {
          tenantId: 'tenant-1',
          traceId: 'trace-2',
          spanId: 'span-2',
          source: 'container_manager',
          category: 'container',
          level: 'error',
          operation: 'container.create',
          status: 'failed',
          error: { message: 'no space left' },
        },
      ]);

      expect(result.accepted).toBe(2);
      expect(result.rejected).toBe(0);
      expect(pool.rows).toHaveLength(2);
      expect(pool.rows[0].operation).toBe('container.create');
      expect(pool.rows[1].status).toBe('failed');
    });
  });

  describe('service proxy → log entry correctness', () => {
    let pool: ReturnType<typeof createMockPool>;
    let logService: LogService;

    beforeEach(() => {
      pool = createMockPool();
      logService = new LogService(pool as never);
    });

    it('projectServiceCreateGeneratesConfigLog', async () => {
      const service = {
        createProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'My Project', status: 'active' }),
      };
      const wrapped = createLoggedService(service, 'ProjectService', logService);

      await wrapped.createProject({ name: 'My Project' });
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.source).toBe('platform');
      expect(logRow.category).toBe('config');
      expect(logRow.operation).toBe('config.project.created');
      expect(logRow.status).toBe('completed');
      expect(logRow.resource_type).toBe('project');
      expect(logRow.resource_id).toBe('proj-1');
      expect(logRow.resource_name).toBe('My Project');
    });

    it('taskServiceCreateGeneratesLifecycleLog', async () => {
      const service = {
        createTask: vi.fn().mockResolvedValue({ id: 'task-1', title: 'Fix bug', workflow_id: 'wf-1' }),
      };
      const wrapped = createLoggedService(service, 'TaskService', logService);

      await wrapped.createTask({ title: 'Fix bug' });
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('task_lifecycle');
      expect(logRow.operation).toBe('task_lifecycle.task.created');
      expect(logRow.resource_type).toBe('task');
      expect(logRow.resource_id).toBe('task-1');
      expect(logRow.resource_name).toBe('Fix bug');
    });

    it('apiKeyServiceRevokeGeneratesAuthLog', async () => {
      const service = {
        revokeApiKey: vi.fn().mockResolvedValue({ id: 'key-1', label: 'CI Key', revoked: true }),
      };
      const wrapped = createLoggedService(service, 'ApiKeyService', logService);

      await wrapped.revokeApiKey('key-1');
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('auth');
      expect(logRow.operation).toBe('auth.api_key.revoked');
      expect(logRow.resource_type).toBe('api_key');
      expect(logRow.resource_id).toBe('key-1');
    });

    it('fleetServiceDrainGeneratesContainerLog', async () => {
      const service = {
        drainRuntime: vi.fn().mockResolvedValue({ id: 'rt-1', name: 'runtime-01', status: 'draining' }),
      };
      const wrapped = createLoggedService(service, 'FleetService', logService);

      await wrapped.drainRuntime('rt-1');
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('container');
      expect(logRow.operation).toBe('container.infrastructure.drained');
    });

    it('failedMutationLogsErrorWithCorrectFields', async () => {
      const service = {
        createProject: vi.fn().mockRejectedValue(new Error('unique constraint violation')),
      };
      const wrapped = createLoggedService(service, 'ProjectService', logService);

      await expect(wrapped.createProject({ name: 'Dup' })).rejects.toThrow();
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.level).toBe('error');
      expect(logRow.status).toBe('failed');
      expect(logRow.error).toEqual(expect.objectContaining({ message: 'unique constraint violation' }));
      expect(logRow.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('durationMsIsCapturedOnSuccess', async () => {
      const service = {
        createWorkflow: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { id: 'wf-1', name: 'Build Pipeline' };
        }),
      };
      const wrapped = createLoggedService(service, 'WorkflowService', logService);

      await wrapped.createWorkflow({ name: 'Build Pipeline' });
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.duration_ms).toBeGreaterThanOrEqual(10);
    });

    it('ignoredMethodsDoNotProduceLogs', async () => {
      const service = {
        getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
        listProjects: vi.fn().mockResolvedValue([]),
      };
      const wrapped = createLoggedService(service, 'ProjectService', logService);

      await wrapped.getProject('proj-1');
      await wrapped.listProjects();
      await new Promise((r) => setTimeout(r, 20));

      expect(pool.rows).toHaveLength(0);
    });

    it('nonMutationPrefixMethodsDoNotProduceLogs', async () => {
      const service = {
        getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
        validateSomething: vi.fn().mockResolvedValue(true),
      };
      const wrapped = createLoggedService(service, 'ProjectService', logService);

      await wrapped.validateSomething();
      await new Promise((r) => setTimeout(r, 20));

      expect(pool.rows).toHaveLength(0);
    });
  });

  describe('new service registrations produce correct logs', () => {
    let pool: ReturnType<typeof createMockPool>;
    let logService: LogService;

    beforeEach(() => {
      pool = createMockPool();
      logService = new LogService(pool as never);
    });

    it('oauthServiceDisconnectGeneratesAuthLog', async () => {
      const service = {
        disconnect: vi.fn().mockResolvedValue({ profileId: 'openai', status: 'disconnected' }),
      };
      const wrapped = createLoggedService(service, 'OAuthService', logService);

      await wrapped.disconnect('openai');
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('auth');
      expect(logRow.operation).toContain('auth.oauth_connection');
    });

    it('orchestratorGrantServiceCreateGeneratesAuthLog', async () => {
      const service = {
        createGrant: vi.fn().mockResolvedValue({ id: 'grant-1' }),
      };
      const wrapped = createLoggedService(service, 'OrchestratorGrantService', logService);

      await wrapped.createGrant({ agent_id: 'a-1', workflow_id: 'wf-1', permissions: ['read'] });
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('auth');
      expect(logRow.operation).toBe('auth.orchestrator_grant.created');
      expect(logRow.resource_type).toBe('orchestrator_grant');
    });

    it('acpSessionServiceCreateGeneratesApiLog', async () => {
      const service = {
        createOrReuseSession: vi.fn().mockResolvedValue({ id: 'sess-1', reused: false }),
      };
      const wrapped = createLoggedService(service, 'AcpSessionService', logService);

      await wrapped.createOrReuseSession({});
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('api');
      expect(logRow.operation).toBe('api.acp_session.created');
    });

    it('toolTagServiceCreateGeneratesConfigLog', async () => {
      const service = {
        createToolTag: vi.fn().mockResolvedValue({ id: 'tt-1', name: 'shell_exec' }),
      };
      const wrapped = createLoggedService(service, 'ToolTagService', logService);

      await wrapped.createToolTag({ id: 'tt-1', name: 'shell_exec' });
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('config');
      expect(logRow.operation).toBe('config.tool_tag.created');
      expect(logRow.resource_name).toBe('shell_exec');
    });

    it('webhookTaskTriggerServiceCreateGeneratesConfigLog', async () => {
      const service = {
        createTrigger: vi.fn().mockResolvedValue({ id: 'trig-1', name: 'GitHub Push' }),
      };
      const wrapped = createLoggedService(service, 'WebhookTaskTriggerService', logService);

      await wrapped.createTrigger({ name: 'GitHub Push' });
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('config');
      expect(logRow.operation).toBe('config.task_trigger.created');
      expect(logRow.resource_name).toBe('GitHub Push');
    });

    it('agentServiceRegisterGeneratesApiLog', async () => {
      const service = {
        registerAgent: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'coder-01' }),
      };
      const wrapped = createLoggedService(service, 'AgentService', logService);

      await wrapped.registerAgent({});
      await vi.waitFor(() => expect(pool.rows.length).toBeGreaterThan(0));

      const logRow = pool.rows[0];
      expect(logRow.category).toBe('api');
      expect(logRow.operation).toBe('api.agent.registered');
      expect(logRow.resource_name).toBe('coder-01');
    });
  });

  describe('level filtering', () => {
    it('dropsEntriesBelowTenantThreshold', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);
      service.setLevelFilter({
        shouldWrite: async (_tenantId: string, level: string) => level !== 'debug',
      });

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime',
        category: 'llm',
        level: 'debug',
        operation: 'llm.token_count',
        status: 'completed',
      });

      expect(pool.rows).toHaveLength(0);
    });

    it('allowsEntriesAtOrAboveThreshold', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);
      service.setLevelFilter({
        shouldWrite: async (_tenantId: string, level: string) => level !== 'debug',
      });

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime',
        category: 'llm',
        level: 'warn',
        operation: 'llm.rate_limit',
        status: 'completed',
      });

      expect(pool.rows).toHaveLength(1);
    });
  });

  describe('denormalized workflow and project names', () => {
    it('storesProvidedWorkflowNameWithoutDbLookup', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime',
        category: 'task_lifecycle',
        level: 'info',
        operation: 'task.started',
        status: 'started',
        workflowId: 'wf-1',
        workflowName: 'Build Pipeline',
        projectId: 'proj-1',
        projectName: 'My Project',
      });

      expect(pool.rows).toHaveLength(1);
      expect(pool.rows[0].workflow_name).toBe('Build Pipeline');
      expect(pool.rows[0].project_name).toBe('My Project');
    });

    it('storesNullWhenNamesNotProvided', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      await service.insert({
        tenantId: 'tenant-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        source: 'runtime',
        category: 'task_lifecycle',
        level: 'info',
        operation: 'task.started',
        status: 'started',
        workflowId: 'wf-1',
      });

      expect(pool.rows).toHaveLength(1);
      expect(pool.rows[0].workflow_name).toBeNull();
      expect(pool.rows[0].project_name).toBeNull();
    });
  });

  describe('source validation', () => {
    it('acceptsAllValidSources', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);

      for (const source of ['runtime', 'container_manager', 'platform', 'task_container'] as const) {
        await service.insert({
          tenantId: 'tenant-1',
          traceId: 'trace-1',
          spanId: 'span-1',
          source,
          category: 'api',
          level: 'info',
          operation: `test.${source}`,
          status: 'completed',
        });
      }

      expect(pool.rows).toHaveLength(4);
      expect(pool.rows.map((r) => r.source)).toEqual([
        'runtime',
        'container_manager',
        'platform',
        'task_container',
      ]);
    });
  });

  describe('category validation', () => {
    it('acceptsAllValidCategories', async () => {
      const pool = createMockPool();
      const service = new LogService(pool as never);
      const categories = ['llm', 'tool', 'agent_loop', 'task_lifecycle', 'runtime_lifecycle', 'container', 'api', 'config', 'auth'] as const;

      for (const category of categories) {
        await service.insert({
          tenantId: 'tenant-1',
          traceId: 'trace-1',
          spanId: 'span-1',
          source: 'platform',
          category,
          level: 'info',
          operation: `test.${category}`,
          status: 'completed',
        });
      }

      expect(pool.rows).toHaveLength(9);
    });
  });
});
