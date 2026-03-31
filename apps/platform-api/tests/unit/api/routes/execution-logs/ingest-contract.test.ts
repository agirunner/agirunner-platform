import { describe, expect, it } from 'vitest';

import { ingestEntrySchema } from '../../../../../src/api/routes/execution-logs/execution-logs.routes.js';

function createEntry() {
  return {
    trace_id: '11111111-1111-4111-8111-111111111111',
    span_id: '22222222-2222-4222-8222-222222222222',
    source: 'runtime' as const,
    category: 'tool' as const,
    level: 'info' as const,
    operation: 'tool.execute',
    status: 'completed' as const,
  };
}

describe('execution log ingest contract', () => {
  it('rejects operations longer than 500 characters', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      operation: 'x'.repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it('rejects workflow names longer than 500 characters', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      workflow_name: 'x'.repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it('rejects workspace names longer than 500 characters', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      workspace_name: 'x'.repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it('rejects stage names longer than 200 characters', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      stage_name: 'x'.repeat(201),
    });

    expect(result.success).toBe(false);
  });

  it('rejects roles longer than 100 characters', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      role: 'x'.repeat(101),
    });

    expect(result.success).toBe(false);
  });

  it('rejects actor identifiers longer than 255 characters', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      actor_id: 'x'.repeat(256),
    });

    expect(result.success).toBe(false);
  });

  it('rejects actor names longer than 255 characters', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      actor_name: 'x'.repeat(256),
    });

    expect(result.success).toBe(false);
  });

  it('accepts execution backend and tool owner classifications', () => {
    const result = ingestEntrySchema.safeParse({
      ...createEntry(),
      execution_backend: 'runtime_plus_task',
      tool_owner: 'task',
    });

    expect(result.success).toBe(true);
  });
});
