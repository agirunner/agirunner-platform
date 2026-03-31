import { describe, expect, it } from 'vitest';

import {
  buildLogFilters,
  DEFAULT_INSPECTOR_FILTERS,
  formatCost,
  readInspectorFilters,
  readInspectorView,
  readSelectedInspectorLogId,
  writeInspectorFilters,
} from './execution-inspector-support.js';

describe('execution inspector filter support', () => {
  it('builds backend log filters from inspector state', () => {
    const filters = buildLogFilters({
      ...DEFAULT_INSPECTOR_FILTERS,
      workflowId: 'wf-1',
      operation: 'task.run',
      actor: 'agent-1',
      search: 'timeout',
    });

    expect(filters.workflow_id).toBe('wf-1');
    expect(filters.stage_name).toBeUndefined();
    expect(filters.work_item_id).toBeUndefined();
    expect(filters.activation_id).toBeUndefined();
    expect(filters.operation).toBe('task.run');
    expect(filters.actor).toBe('agent-1');
    expect(filters.search).toBe('timeout');
    expect(filters.level).toBe('info');
    expect(filters.since).toBeTypeOf('string');
    expect(filters.until).toBeTypeOf('string');
  });

  it('reads and writes inspector filters from url search params', () => {
    const initial = new URLSearchParams('workflow=wf-1&work_item=wi-1&time_window=6&level=error');
    const filters = readInspectorFilters(initial);

    expect(filters.workflowId).toBe('wf-1');
    expect(filters.timeWindowHours).toBe('6');
    expect(filters.level).toBe('error');
    expect('workItemId' in filters).toBe(false);
    expect('stageName' in filters).toBe(false);
    expect('activationId' in filters).toBe(false);

    const next = writeInspectorFilters(initial, {
      ...DEFAULT_INSPECTOR_FILTERS,
    });

    expect(next.get('workflow')).toBeNull();
    expect(next.get('work_item')).toBeNull();
    expect(next.get('activation')).toBeNull();
    expect(next.get('stage')).toBeNull();
    expect(next.get('time_window')).toBeNull();
    expect(next.get('level')).toBeNull();
  });

  it('reads selected log id and inspector view from search params', () => {
    const params = new URLSearchParams('log=42&view=detailed');

    expect(readSelectedInspectorLogId(params)).toBe(42);
    expect(readInspectorView(params)).toBe('summary');
    expect(readInspectorView(new URLSearchParams())).toBe('raw');
    expect(readInspectorView(new URLSearchParams('view=summary'))).toBe('summary');
    expect(readInspectorView(new URLSearchParams('view=debug'))).toBe('raw');
  });

  it('formats zero cost as $0.00 and non-zero cost with four decimal places', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(null)).toBe('$0.00');
    expect(formatCost(undefined)).toBe('$0.00');
    expect(formatCost(NaN)).toBe('$0.00');
    expect(formatCost(1.5)).toBe('$1.5000');
    expect(formatCost(0.0012)).toBe('$0.0012');
    expect(formatCost('2.5')).toBe('$2.5000');
  });
});
