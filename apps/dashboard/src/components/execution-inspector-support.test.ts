import { describe, expect, it } from 'vitest';

import {
  buildLogFilters,
  DEFAULT_INSPECTOR_FILTERS,
  readInspectorFilters,
  readInspectorView,
  readSelectedInspectorLogId,
  summarizeLogContext,
  writeInspectorFilters,
} from './execution-inspector-support.js';

describe('execution inspector support', () => {
  it('builds backend log filters from inspector state', () => {
    const filters = buildLogFilters({
      ...DEFAULT_INSPECTOR_FILTERS,
      workflowId: 'wf-1',
      stageName: 'build',
      operation: 'task.run',
      actor: 'agent-1',
      search: 'timeout',
    });

    expect(filters.workflow_id).toBe('wf-1');
    expect(filters.stage_name).toBe('build');
    expect(filters.operation).toBe('task.run');
    expect(filters.actor).toBe('agent-1');
    expect(filters.search).toBe('timeout');
    expect(filters.level).toBe('info');
    expect(filters.since).toBeTypeOf('string');
    expect(filters.until).toBeTypeOf('string');
  });

  it('summarizes workflow, task, stage, work item, and activation context', () => {
    expect(
      summarizeLogContext({
        id: 1,
        trace_id: 'trace-1',
        span_id: 'span-1',
        source: 'platform',
        category: 'task_lifecycle',
        level: 'info',
        operation: 'task.run',
        status: 'completed',
        workflow_name: 'Delivery',
        task_title: 'Implement billing',
        stage_name: 'build',
        work_item_id: 'work-item-12345678',
        activation_id: 'activation-12345678',
        actor_type: 'agent',
        actor_id: 'agent-1',
        created_at: '2026-03-11T00:00:00Z',
      },
    )).toEqual([
      'workflow Delivery',
      'task Implement billing',
      'stage build',
      'work item work-ite',
      'activation activati',
    ]);
  });

  it('reads and writes inspector filters from url search params', () => {
    const initial = new URLSearchParams('workflow=wf-1&work_item=wi-1&time_window=6&level=error');
    const filters = readInspectorFilters(initial);

    expect(filters.workflowId).toBe('wf-1');
    expect(filters.workItemId).toBe('wi-1');
    expect(filters.timeWindowHours).toBe('6');
    expect(filters.level).toBe('error');

    const next = writeInspectorFilters(
      initial,
      {
        ...DEFAULT_INSPECTOR_FILTERS,
        activationId: 'act-1',
        stageName: 'review',
      },
    );

    expect(next.get('workflow')).toBeNull();
    expect(next.get('work_item')).toBeNull();
    expect(next.get('activation')).toBe('act-1');
    expect(next.get('stage')).toBe('review');
    expect(next.get('time_window')).toBeNull();
    expect(next.get('level')).toBeNull();
  });

  it('reads selected log id and inspector view from search params', () => {
    const params = new URLSearchParams('log=42&view=debug');

    expect(readSelectedInspectorLogId(params)).toBe(42);
    expect(readInspectorView(params)).toBe('debug');
    expect(readInspectorView(new URLSearchParams())).toBe('summary');
  });
});
