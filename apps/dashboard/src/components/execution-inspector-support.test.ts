import { describe, expect, it } from 'vitest';

import {
  buildLogFilters,
  DEFAULT_INSPECTOR_FILTERS,
  describeExecutionHeadline,
  describeExecutionNextAction,
  describeExecutionOperationLabel,
  describeExecutionOperationOption,
  describeExecutionSummary,
  formatCost,
  readInspectorFilters,
  readInspectorView,
  readSelectedInspectorLogId,
  readExecutionSignals,
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
      'board Delivery',
      'step Implement billing',
      'stage build',
      'work item work-ite',
      'activation activati',
    ]);
  });

  it('builds operator-readable inspector packet copy from execution entries', () => {
    const entry = {
      id: 1,
      trace_id: 'trace-1',
      span_id: 'span-1',
      source: 'platform',
      category: 'task_lifecycle',
      level: 'error',
      operation: 'task_lifecycle.workflow.activation_failed',
      status: 'failed',
      workflow_name: 'Delivery',
      task_title: 'Implement billing',
      stage_name: 'build',
      work_item_id: 'work-item-12345678',
      activation_id: 'activation-12345678',
      is_orchestrator_task: true,
      actor_type: 'agent',
      actor_id: 'agent-1',
      actor_name: 'Coordinator',
      created_at: '2026-03-11T00:00:00Z',
      error: { message: 'container timed out' },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Orchestrator activity failed during Workflow activation failed',
    );
    expect(describeExecutionSummary(entry)).toBe(
      'board Delivery • stage build • work item work-ite • activation activati • Recorded by Coordinator • via platform • task lifecycle',
    );
    expect(describeExecutionNextAction(entry)).toBe(
      'Review the failure packet, then decide whether to retry, rework, or escalate the affected step.',
    );
    expect(readExecutionSignals(entry)).toEqual([
      'Orchestrator',
      'Activation',
      'Work item',
      'Stage',
      'Recovery',
    ]);
  });

  it('describes task context attachments as continuity packets', () => {
    const entry = {
      id: 2,
      trace_id: 'trace-2',
      span_id: 'span-2',
      source: 'platform',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.context.attachments',
      status: 'completed',
      workflow_name: 'Delivery',
      task_title: 'Review smoke result',
      stage_name: 'qa',
      work_item_id: 'work-item-12345678',
      activation_id: 'activation-12345678',
      actor_type: 'agent',
      actor_id: 'agent-1',
      actor_name: 'QA Agent',
      created_at: '2026-03-11T00:00:00Z',
      payload: {
        predecessor_handoff_present: true,
        predecessor_handoff_resolution_present: true,
        predecessor_handoff_source: 'local_work_item',
        recent_handoff_count: 1,
        work_item_continuity_present: true,
        project_memory_index_present: true,
        project_memory_index_count: 2,
        project_artifact_index_present: true,
        project_artifact_index_count: 1,
        document_count: 0,
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Step Review smoke result recorded continuity packet',
    );
    expect(summarizeLogContext(entry)).toEqual([
      'board Delivery',
      'step Review smoke result',
      'stage qa',
      'work item work-ite',
      'activation activati',
      'Continuity packet',
    ]);
    expect(readExecutionSignals(entry)).toEqual([
      'Continuity',
      'Activation',
      'Work item',
      'Stage',
    ]);
    expect(describeExecutionSummary(entry)).toContain('Continuity packet');
  });

  it('describes predecessor handoff attachments as continuity packets', () => {
    const entry = {
      id: 3,
      trace_id: 'trace-3',
      span_id: 'span-3',
      source: 'platform',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.context.predecessor_handoff.attach',
      status: 'completed',
      workflow_name: 'Delivery',
      task_title: 'Review smoke result',
      stage_name: 'qa',
      work_item_id: 'work-item-12345678',
      activation_id: 'activation-12345678',
      actor_type: 'agent',
      actor_id: 'agent-1',
      actor_name: 'QA Agent',
      created_at: '2026-03-11T00:00:00Z',
      payload: {
        current_workflow_id: 'workflow-1',
        current_work_item_id: 'work-item-12345678',
        current_task_id: 'task-1',
        resolution_source: 'local_work_item',
        has_predecessor_handoff: true,
        candidate_handoff_ids: ['handoff-ctx-1'],
        candidate_task_ids: ['task-upstream-1'],
        selected_handoff_id: 'handoff-ctx-1',
        selected_handoff_workflow_id: 'workflow-1',
        selected_handoff_work_item_id: 'work-item-12345678',
        selected_handoff_role: 'developer',
        selected_handoff_sequence: 4,
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Step Review smoke result attached predecessor handoff',
    );
    expect(summarizeLogContext(entry)).toEqual([
      'board Delivery',
      'step Review smoke result',
      'stage qa',
      'work item work-ite',
      'activation activati',
      'Predecessor handoff packet',
    ]);
    expect(readExecutionSignals(entry)).toEqual([
      'Continuity',
      'Handoff',
      'Activation',
      'Work item',
      'Stage',
    ]);
    expect(describeExecutionSummary(entry)).toContain('Predecessor handoff packet');
  });

  it('humanizes execution activity labels for filters and summaries', () => {
    expect(describeExecutionOperationLabel('task_lifecycle.workflow.activation_failed')).toBe(
      'Workflow activation failed',
    );
    expect(describeExecutionOperationOption('tool.exec')).toBe('Tool exec · tool.exec');
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
    expect(readInspectorView(new URLSearchParams())).toBe('raw');
    expect(readInspectorView(new URLSearchParams('view=summary'))).toBe('summary');
  });

  it('MCL-005: formats zero cost as $0.00 and non-zero cost with four decimal places', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(null)).toBe('$0.00');
    expect(formatCost(undefined)).toBe('$0.00');
    expect(formatCost(NaN)).toBe('$0.00');
    expect(formatCost(1.5)).toBe('$1.5000');
    expect(formatCost(0.0012)).toBe('$0.0012');
    expect(formatCost('2.5')).toBe('$2.5000');
  });
});
