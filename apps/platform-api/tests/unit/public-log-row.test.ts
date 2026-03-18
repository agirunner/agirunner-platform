import { describe, expect, it } from 'vitest';

import { PUBLIC_LOG_CSV_COLUMNS, toPublicLogRow } from '../../src/logging/public-log-row.js';

describe('public log row', () => {
  it('exposes only canonical stage context to API consumers', () => {
    const row = toPublicLogRow({
      id: '1',
      tenant_id: 'tenant-1',
      trace_id: 'trace-1',
      span_id: 'span-1',
      parent_span_id: null,
      source: 'runtime',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.execute',
      status: 'completed',
      duration_ms: 10,
      payload: {},
      error: null,
      workspace_id: null,
      workflow_id: 'workflow-1',
      workflow_name: 'Flow',
      workspace_name: null,
      task_id: 'task-1',
      work_item_id: 'work-item-1',
      stage_name: null,
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
    });

    expect(row.stage_name).toBeNull();
  });

  it('exports only canonical stage context columns', () => {
    expect(PUBLIC_LOG_CSV_COLUMNS).toContain('stage_name');
    expect(PUBLIC_LOG_CSV_COLUMNS).not.toContain('workflow_phase');
  });

  it('redacts secret-bearing payload and error fields in public rows', () => {
    const row = toPublicLogRow({
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
        prompt_summary: 'safe summary',
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
    });

    expect(row.payload.api_key).toBe('[REDACTED]');
    expect((row.payload.nested as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect((row.payload.nested as Record<string, unknown>).secret_ref).toBe('[REDACTED]');
    expect((row.payload.nested as Record<string, unknown>).safe).toBe('visible');
    expect(row.payload.prompt_summary).toBe('safe summary');
    expect(row.error).toEqual({
      code: 'AUTH_FAILED',
      message: '[REDACTED]',
      stack: '[REDACTED]',
    });
  });

  it('redacts embedded token-like secrets inside longer public prose fields', () => {
    const row = toPublicLogRow({
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
        detail:
          'User pasted eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature into the transcript.',
      },
      error: {
        code: 'AUTH_FAILED',
        message: 'Captured sk-live-abc123xyz987 in the failure summary.',
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
    });

    expect(row.payload.detail).toBe('[REDACTED]');
    expect(row.error).toEqual({
      code: 'AUTH_FAILED',
      message: '[REDACTED]',
    });
  });

  it('preserves non-secret token omission diagnostics in public payloads', () => {
    const row = toPublicLogRow({
      id: '1',
      tenant_id: 'tenant-1',
      trace_id: 'trace-1',
      span_id: 'span-1',
      parent_span_id: null,
      source: 'runtime',
      category: 'llm',
      level: 'info',
      operation: 'llm.chat_stream',
      status: 'completed',
      duration_ms: 10,
      payload: {
        max_output_tokens_omission_reason: 'not_supplied_in_task_contract',
      },
      error: null,
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
    });

    expect(row.payload.max_output_tokens_omission_reason).toBe('not_supplied_in_task_contract');
  });
});
