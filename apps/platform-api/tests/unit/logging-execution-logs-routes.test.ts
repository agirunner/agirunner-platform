import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'operator',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'prefix',
    };
  },
  withScope: () => async () => {},
}));

vi.mock('../../src/auth/rbac.js', () => ({
  withRole: () => async () => {},
}));

describe('execution-logs route helpers', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  describe('parseCsv', () => {
    function parseCsv(raw?: string): string[] | undefined {
      if (!raw) return undefined;
      const values = raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      return values.length > 0 ? values : undefined;
    }

    it('parsesCommaSeparatedValues', () => {
      expect(parseCsv('llm,tool,agent_loop')).toEqual(['llm', 'tool', 'agent_loop']);
    });

    it('trimsWhitespace', () => {
      expect(parseCsv(' llm , tool ')).toEqual(['llm', 'tool']);
    });

    it('returnsUndefinedForEmptyString', () => {
      expect(parseCsv('')).toBeUndefined();
    });

    it('returnsUndefinedForUndefined', () => {
      expect(parseCsv(undefined)).toBeUndefined();
    });

    it('filtersEmptySegments', () => {
      expect(parseCsv('llm,,tool')).toEqual(['llm', 'tool']);
    });
  });

  describe('parseBoolean', () => {
    function parseBoolean(raw?: string): boolean | undefined {
      if (raw === undefined) return undefined;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new Error(`invalid boolean: ${raw}`);
    }

    it('parsesTrueAndFalse', () => {
      expect(parseBoolean('true')).toBe(true);
      expect(parseBoolean('false')).toBe(false);
    });

    it('returnsUndefinedWhenMissing', () => {
      expect(parseBoolean()).toBeUndefined();
    });

    it('rejectsInvalidBooleanStrings', () => {
      expect(() => parseBoolean('yes')).toThrow('invalid boolean');
    });
  });

  describe('ingest schema validation', () => {
    const validSources = ['runtime', 'container_manager', 'platform', 'task_container'] as const;
    const validCategories = [
      'llm',
      'tool',
      'agent_loop',
      'task_lifecycle',
      'runtime_lifecycle',
      'container',
      'api',
      'config',
      'auth',
    ] as const;
    const validLevels = ['debug', 'info', 'warn', 'error'] as const;
    const validStatuses = ['started', 'completed', 'failed', 'skipped'] as const;

    const ingestEntrySchema = z.object({
      trace_id: z.string().uuid(),
      span_id: z.string().uuid(),
      parent_span_id: z.string().uuid().nullable().optional(),
      source: z.enum(validSources),
      category: z.enum(validCategories),
      level: z.enum(validLevels).default('info'),
      operation: z.string().min(1).max(500),
      status: z.enum(validStatuses),
      duration_ms: z.number().int().min(0).nullable().optional(),
      payload: z.record(z.unknown()).optional(),
      error: z
        .object({
          code: z.string().max(100).optional(),
          message: z.string().max(5000),
          stack: z.string().max(10000).optional(),
        })
        .nullable()
        .optional(),
      workspace_id: z.string().uuid().nullable().optional(),
      workflow_id: z.string().uuid().nullable().optional(),
      task_id: z.string().uuid().nullable().optional(),
      work_item_id: z.string().uuid().nullable().optional(),
      stage_name: z.string().max(200).nullable().optional(),
      activation_id: z.string().uuid().nullable().optional(),
      is_orchestrator_task: z.boolean().optional(),
      actor_type: z.string().max(50).optional(),
      actor_id: z.string().max(255).optional(),
      actor_name: z.string().max(255).optional(),
      resource_type: z.string().max(100).nullable().optional(),
      resource_id: z.string().max(255).nullable().optional(),
      resource_name: z.string().max(500).nullable().optional(),
      created_at: z.string().datetime().optional(),
    });

    const ingestSchema = z.object({
      entries: z.array(ingestEntrySchema).min(1).max(100),
    });

    it('acceptsValidMinimalEntry', () => {
      const result = ingestSchema.safeParse({
        entries: [
          {
            trace_id: '00000000-0000-0000-0000-000000000001',
            span_id: '00000000-0000-0000-0000-000000000002',
            source: 'runtime',
            category: 'llm',
            operation: 'llm.chat_stream',
            status: 'completed',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('acceptsValidFullEntry', () => {
      const result = ingestSchema.safeParse({
        entries: [
          {
            trace_id: '00000000-0000-0000-0000-000000000001',
            span_id: '00000000-0000-0000-0000-000000000002',
            parent_span_id: '00000000-0000-0000-0000-000000000003',
            source: 'runtime',
            category: 'llm',
            level: 'info',
            operation: 'llm.chat_stream',
            status: 'completed',
            duration_ms: 1200,
            payload: { model: 'gpt-4.1-mini', provider: 'openai' },
            error: null,
            workspace_id: '00000000-0000-0000-0000-000000000004',
            workflow_id: '00000000-0000-0000-0000-000000000005',
            task_id: '00000000-0000-0000-0000-000000000006',
            work_item_id: '00000000-0000-0000-0000-000000000008',
            stage_name: 'implementation',
            activation_id: '00000000-0000-0000-0000-000000000009',
            is_orchestrator_task: true,
            actor_type: 'worker',
            actor_id: 'w-1',
            actor_name: 'worker-01',
            resource_type: 'container',
            resource_id: 'runtime-a59dbff2-b12b9434',
            resource_name: 'OpenAI',
            created_at: '2026-03-09T15:30:00.123Z',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejectsEmptyEntries', () => {
      const result = ingestSchema.safeParse({ entries: [] });
      expect(result.success).toBe(false);
    });

    it('rejectsMoreThan100Entries', () => {
      const entries = Array.from({ length: 101 }, () => ({
        trace_id: '00000000-0000-0000-0000-000000000001',
        span_id: '00000000-0000-0000-0000-000000000002',
        source: 'runtime',
        category: 'llm',
        operation: 'test',
        status: 'completed',
      }));
      const result = ingestSchema.safeParse({ entries });
      expect(result.success).toBe(false);
    });

    it('rejectsInvalidSource', () => {
      const result = ingestSchema.safeParse({
        entries: [
          {
            trace_id: '00000000-0000-0000-0000-000000000001',
            span_id: '00000000-0000-0000-0000-000000000002',
            source: 'invalid',
            category: 'llm',
            operation: 'test',
            status: 'completed',
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejectsInvalidUuidFields', () => {
      const result = ingestSchema.safeParse({
        entries: [
          {
            trace_id: 'not-a-uuid',
            span_id: '00000000-0000-0000-0000-000000000002',
            source: 'runtime',
            category: 'llm',
            operation: 'test',
            status: 'completed',
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('defaultsLevelToInfo', () => {
      const result = ingestSchema.safeParse({
        entries: [
          {
            trace_id: '00000000-0000-0000-0000-000000000001',
            span_id: '00000000-0000-0000-0000-000000000002',
            source: 'runtime',
            category: 'llm',
            operation: 'test',
            status: 'completed',
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entries[0].level).toBe('info');
      }
    });
  });

  describe('csvExport helpers', () => {
    function csvEscape(value: string): string {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    }

    it('escapesCommas', () => {
      expect(csvEscape('hello,world')).toBe('"hello,world"');
    });

    it('escapesDoubleQuotes', () => {
      expect(csvEscape('say "hello"')).toBe('"say ""hello"""');
    });

    it('escapesNewlines', () => {
      expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    });

    it('passesSimpleStringsThrough', () => {
      expect(csvEscape('simple')).toBe('simple');
    });
  });

  describe('wire redaction', () => {
    const unsafeRow = {
      id: '1',
      tenant_id: 'tenant-1',
      trace_id: 'trace-1',
      span_id: 'span-1',
      parent_span_id: null,
      source: 'runtime',
      category: 'auth',
      level: 'error',
      operation: 'auth.oauth_connection.failed',
      status: 'failed',
      duration_ms: 10,
      payload: {
        api_key: 'sk-live-secret',
        nested: {
          authorization: 'Bearer top-secret',
          secret_ref: 'secret:OPENAI_API_KEY',
          safe: 'visible',
        },
        predecessor_handoff_resolution_present: true,
        predecessor_handoff_source: 'local_work_item',
        workspace_memory_index_present: true,
        workspace_memory_index_count: 2,
        workspace_artifact_index_present: true,
        workspace_artifact_index_count: 1,
        max_output_tokens_omission_reason: 'not_supplied_in_task_contract',
      },
      error: {
        code: 'AUTH_FAILED',
        message: 'Bearer sk-live-secret leaked',
        stack: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      },
      workspace_id: null,
      workflow_id: 'workflow-1',
      workflow_name: 'Flow',
      workspace_name: null,
      task_id: 'task-1',
      work_item_id: 'work-item-1',
      stage_name: 'review',
      activation_id: 'activation-1',
      is_orchestrator_task: false,
      task_title: 'Run work',
      role: 'developer',
      actor_type: 'system',
      actor_id: 'worker-1',
      actor_name: 'worker-1',
      resource_type: null,
      resource_id: null,
      resource_name: null,
      created_at: '2026-03-11T00:00:00.000Z',
    };

    async function registerRoutes() {
      const { executionLogRoutes } = await import('../../src/api/routes/execution-logs.routes.js');

      app = fastify();
      registerErrorHandler(app);
      app.decorate('config', { EVENT_STREAM_KEEPALIVE_INTERVAL_MS: 1000 });
      app.decorate('logStreamService', { subscribe: vi.fn(() => () => {}) });
      app.decorate('logService', {
        insertBatch: vi.fn(),
        query: vi.fn().mockResolvedValue({
          data: [unsafeRow],
          pagination: {
            per_page: 100,
            has_more: false,
            next_cursor: null,
            prev_cursor: null,
          },
        }),
        getById: vi.fn().mockResolvedValue(unsafeRow),
        export: vi.fn(async function* () {
          yield unsafeRow;
        }),
        stats: vi.fn(),
        operations: vi.fn(),
        roles: vi.fn(),
        actors: vi.fn(),
      });

      await app.register(executionLogRoutes);
    }

    it('redacts queried log payloads on the JSON wire', async () => {
      await registerRoutes();

      const response = await app!.inject({
        method: 'GET',
        url: '/api/v1/logs',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('sk-live-secret');
      expect(response.body).not.toContain('Bearer top-secret');
      expect(response.body).not.toContain('secret:OPENAI_API_KEY');
      expect(response.body).toContain('[REDACTED]');

      const payload = response.json();
      expect(payload.data[0].payload.api_key).toBe('[REDACTED]');
      expect(payload.data[0].payload.nested.authorization).toBe('[REDACTED]');
      expect(payload.data[0].payload.nested.secret_ref).toBe('[REDACTED]');
      expect(payload.data[0].error.message).toBe('[REDACTED]');
    });

    it('returns summary rows without payload bodies when detail=summary is requested', async () => {
      await registerRoutes();

      const response = await app!.inject({
        method: 'GET',
        url: '/api/v1/logs?detail=summary',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.data[0].payload).toBeNull();
      expect(payload.data[0].error).toEqual({
        code: 'AUTH_FAILED',
        message: '[REDACTED]',
      });
      expect(response.body).not.toContain('nested');
    });

    it('returns a single full log entry by id for lazy detail loading', async () => {
      await registerRoutes();

      const response = await app!.inject({
        method: 'GET',
        url: '/api/v1/logs/1',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.data.id).toBe('1');
      expect(payload.data.payload.nested.safe).toBe('visible');
      expect(payload.data.payload.api_key).toBe('[REDACTED]');
      expect(payload.data.payload.predecessor_handoff_resolution_present).toBe(true);
      expect(payload.data.payload.predecessor_handoff_source).toBe('local_work_item');
      expect(payload.data.payload.workspace_memory_index_present).toBe(true);
      expect(payload.data.payload.workspace_artifact_index_present).toBe(true);
      expect(payload.data.payload.max_output_tokens_omission_reason).toBe(
        'not_supplied_in_task_contract',
      );
    });

    it('redacts exported logs on the JSON wire', async () => {
      await registerRoutes();

      const response = await app!.inject({
        method: 'GET',
        url: '/api/v1/logs/export?format=json',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).not.toContain('sk-live-secret');
      expect(response.body).not.toContain('Bearer top-secret');
      expect(response.body).not.toContain('secret:OPENAI_API_KEY');
      expect(response.body).toContain('[REDACTED]');
    });

    it('redacts exported logs on the CSV wire', async () => {
      await registerRoutes();

      const response = await app!.inject({
        method: 'GET',
        url: '/api/v1/logs/export?format=csv',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.body).toContain('payload');
      expect(response.body).not.toContain('sk-live-secret');
      expect(response.body).not.toContain('Bearer top-secret');
      expect(response.body).not.toContain('secret:OPENAI_API_KEY');
      expect(response.body).toContain('[REDACTED]');
    });
  });
});
