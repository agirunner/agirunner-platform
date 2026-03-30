import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LogEntry } from '../../lib/api.js';
import { LogEntryDetail } from './log-entry-detail.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 1,
    trace_id: 'trace-1',
    span_id: 'span-1',
    parent_span_id: null,
    source: 'runtime',
    category: 'task_lifecycle',
    level: 'info',
    operation: 'task_lifecycle.task.claimed',
    status: 'completed',
    duration_ms: 12,
    payload: null,
    error: null,
    workspace_id: null,
    workspace_name: null,
    workflow_id: null,
    workflow_name: null,
    task_id: 'task-1',
    work_item_id: 'work-item-1',
    stage_name: 'implementation',
    activation_id: 'activation-1',
    is_orchestrator_task: true,
    execution_backend: 'runtime_plus_task',
    tool_owner: 'task',
    task_title: 'Orchestrate product brief',
    role: 'orchestrator',
    actor_type: 'agent',
    actor_id: 'agent-1',
    actor_name: 'Orchestrator execution',
    resource_type: null,
    resource_id: null,
    resource_name: null,
    created_at: '2026-03-30T12:00:00.000Z',
    ...overrides,
  };
}

describe('LogEntryDetail', () => {
  it('renders a single orchestrator execution actor label instead of duplicating the generic actor surface', () => {
    const html = renderToStaticMarkup(<LogEntryDetail entry={makeEntry()} />);

    expect(html).toContain('Actor');
    expect(html.match(/Orchestrator execution/g)).toHaveLength(1);
  });
});
