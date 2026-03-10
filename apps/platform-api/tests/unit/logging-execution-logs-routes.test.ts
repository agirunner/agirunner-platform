import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('execution-logs route helpers', () => {
  describe('parseCsv', () => {
    function parseCsv(raw?: string): string[] | undefined {
      if (!raw) return undefined;
      const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
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

  describe('ingest schema validation', () => {
    const validSources = ['runtime', 'container_manager', 'platform', 'task_container'] as const;
    const validCategories = ['llm', 'tool', 'agent_loop', 'task_lifecycle', 'container', 'api', 'config', 'auth'] as const;
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
      metadata: z.record(z.unknown()).optional(),
      error: z.object({
        code: z.string().max(100).optional(),
        message: z.string().max(5000),
        stack: z.string().max(10000).optional(),
      }).nullable().optional(),
      project_id: z.string().uuid().nullable().optional(),
      workflow_id: z.string().uuid().nullable().optional(),
      task_id: z.string().uuid().nullable().optional(),
      actor_type: z.string().max(50).optional(),
      actor_id: z.string().max(255).optional(),
      actor_name: z.string().max(255).optional(),
      resource_type: z.string().max(100).nullable().optional(),
      resource_id: z.string().uuid().nullable().optional(),
      resource_name: z.string().max(500).nullable().optional(),
      created_at: z.string().datetime().optional(),
    });

    const ingestSchema = z.object({
      entries: z.array(ingestEntrySchema).min(1).max(100),
    });

    it('acceptsValidMinimalEntry', () => {
      const result = ingestSchema.safeParse({
        entries: [{
          trace_id: '00000000-0000-0000-0000-000000000001',
          span_id: '00000000-0000-0000-0000-000000000002',
          source: 'runtime',
          category: 'llm',
          operation: 'llm.chat_stream',
          status: 'completed',
        }],
      });
      expect(result.success).toBe(true);
    });

    it('acceptsValidFullEntry', () => {
      const result = ingestSchema.safeParse({
        entries: [{
          trace_id: '00000000-0000-0000-0000-000000000001',
          span_id: '00000000-0000-0000-0000-000000000002',
          parent_span_id: '00000000-0000-0000-0000-000000000003',
          source: 'runtime',
          category: 'llm',
          level: 'info',
          operation: 'llm.chat_stream',
          status: 'completed',
          duration_ms: 1200,
          metadata: { model: 'gpt-4.1-mini', provider: 'openai' },
          error: null,
          project_id: '00000000-0000-0000-0000-000000000004',
          workflow_id: '00000000-0000-0000-0000-000000000005',
          task_id: '00000000-0000-0000-0000-000000000006',
          actor_type: 'worker',
          actor_id: 'w-1',
          actor_name: 'worker-01',
          resource_type: 'llm_provider',
          resource_id: '00000000-0000-0000-0000-000000000007',
          resource_name: 'OpenAI',
          created_at: '2026-03-09T15:30:00.123Z',
        }],
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
        entries: [{
          trace_id: '00000000-0000-0000-0000-000000000001',
          span_id: '00000000-0000-0000-0000-000000000002',
          source: 'invalid',
          category: 'llm',
          operation: 'test',
          status: 'completed',
        }],
      });
      expect(result.success).toBe(false);
    });

    it('rejectsInvalidUuidFields', () => {
      const result = ingestSchema.safeParse({
        entries: [{
          trace_id: 'not-a-uuid',
          span_id: '00000000-0000-0000-0000-000000000002',
          source: 'runtime',
          category: 'llm',
          operation: 'test',
          status: 'completed',
        }],
      });
      expect(result.success).toBe(false);
    });

    it('defaultsLevelToInfo', () => {
      const result = ingestSchema.safeParse({
        entries: [{
          trace_id: '00000000-0000-0000-0000-000000000001',
          span_id: '00000000-0000-0000-0000-000000000002',
          source: 'runtime',
          category: 'llm',
          operation: 'test',
          status: 'completed',
        }],
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
});
