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
      'workflow Delivery • stage build • work item work-ite • activation activati • Recorded by Coordinator • via platform • task lifecycle',
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
        workspace_memory_index_present: true,
        workspace_memory_index_count: 2,
        workspace_artifact_index_present: true,
        workspace_artifact_index_count: 1,
        document_count: 0,
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Step Review smoke result recorded continuity packet',
    );
    expect(summarizeLogContext(entry)).toEqual([
      'workflow Delivery',
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
      'workflow Delivery',
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

  it('describes handoff submission logs as explicit governance packets', () => {
    const entry = {
      id: 4,
      trace_id: 'trace-4',
      span_id: 'span-4',
      source: 'platform',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.handoff_submitted',
      status: 'completed',
      workflow_name: 'Delivery',
      task_title: 'Review smoke result',
      stage_name: 'qa',
      work_item_id: 'work-item-12345678',
      actor_type: 'agent',
      actor_id: 'agent-1',
      actor_name: 'QA Agent',
      created_at: '2026-03-11T00:00:00Z',
      payload: {
        completion: 'completed',
        summary: 'Verified the smoke run and passed the fix forward.',
        successor_context: 'Promote the verified package to release review.',
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Step Review smoke result submitted specialist handoff',
    );
    expect(summarizeLogContext(entry)).toEqual([
      'workflow Delivery',
      'step Review smoke result',
      'stage qa',
      'work item work-ite',
      'Handoff packet',
    ]);
    expect(describeExecutionNextAction(entry)).toBe(
      'Review the handoff summary and successor context before reactivating downstream work.',
    );
    expect(readExecutionSignals(entry)).toEqual([
      'Governance',
      'Handoff',
      'Work item',
      'Stage',
    ]);
  });

  it('describes assessment resolution logs as explicit assessment packets', () => {
    const entry = {
      id: 5,
      trace_id: 'trace-5',
      span_id: 'span-5',
      source: 'platform',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.assessment_resolution_skipped',
      status: 'skipped',
      workflow_name: 'Delivery',
      task_title: 'Review smoke result',
      stage_name: 'qa',
      work_item_id: 'work-item-12345678',
      actor_type: 'system',
      actor_id: 'platform',
      actor_name: 'Platform',
      created_at: '2026-03-11T00:00:00Z',
      payload: {
        reason: 'No candidate handoff was available.',
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Step Review smoke result skipped assessment resolution',
    );
    expect(summarizeLogContext(entry)).toEqual([
      'workflow Delivery',
      'step Review smoke result',
      'stage qa',
      'work item work-ite',
      'Assessment resolution packet',
    ]);
    expect(describeExecutionNextAction(entry)).toBe(
      'Check why the assessment resolution was skipped before assuming the workflow is ready to continue.',
    );
    expect(readExecutionSignals(entry)).toEqual([
      'Governance',
      'Assessment',
      'Work item',
      'Stage',
    ]);
  });

  it('describes retry and rework governance logs as recovery packets', () => {
    const retryEntry = {
      id: 6,
      trace_id: 'trace-6',
      span_id: 'span-6',
      source: 'platform',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.retry_scheduled',
      status: 'completed',
      workflow_name: 'Delivery',
      task_title: 'Implement billing',
      stage_name: 'build',
      work_item_id: 'work-item-12345678',
      activation_id: 'activation-12345678',
      actor_type: 'system',
      actor_id: 'platform',
      actor_name: 'Platform',
      created_at: '2026-03-11T00:00:00Z',
    } as const;
    const reworkEntry = {
      ...retryEntry,
      id: 7,
      trace_id: 'trace-7',
      span_id: 'span-7',
      operation: 'task.max_rework_exceeded',
      activation_id: null,
    } as const;

    expect(describeExecutionHeadline(retryEntry)).toBe(
      'Step Implement billing scheduled retry',
    );
    expect(describeExecutionNextAction(retryEntry)).toBe(
      'Confirm the retry lane has the right brief, limits, and predecessor context before it reruns.',
    );
    expect(readExecutionSignals(retryEntry)).toEqual([
      'Governance',
      'Retry',
      'Activation',
      'Work item',
      'Stage',
    ]);
    expect(describeExecutionHeadline(reworkEntry)).toBe(
      'Step Implement billing exceeded rework limit',
    );
    expect(describeExecutionNextAction(reworkEntry)).toBe(
      'Decide whether to escalate, widen the brief, or stop the lane before more rework burns time.',
    );
    expect(readExecutionSignals(reworkEntry)).toEqual([
      'Governance',
      'Rework',
      'Work item',
      'Stage',
    ]);
  });

  it('describes escalation governance logs as explicit escalation packets', () => {
    const entry = {
      id: 8,
      trace_id: 'trace-8',
      span_id: 'span-8',
      source: 'platform',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'task.escalation_response_recorded',
      status: 'completed',
      workflow_name: 'Delivery',
      task_title: 'Implement billing',
      stage_name: 'review',
      work_item_id: 'work-item-12345678',
      actor_type: 'operator',
      actor_id: 'user-1',
      actor_name: 'Operator',
      created_at: '2026-03-11T00:00:00Z',
      payload: {
        response: 'Approved for a weekend rollout window.',
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Step Implement billing recorded escalation response',
    );
    expect(summarizeLogContext(entry)).toEqual([
      'workflow Delivery',
      'step Implement billing',
      'stage review',
      'work item work-ite',
      'Escalation packet',
    ]);
    expect(describeExecutionNextAction(entry)).toBe(
      'Review the response and confirm the downstream task now has enough direction to continue.',
    );
    expect(readExecutionSignals(entry)).toEqual([
      'Governance',
      'Escalation',
      'Work item',
      'Stage',
    ]);
  });

  it('humanizes execution activity labels for filters and summaries', () => {
    expect(describeExecutionOperationLabel('task_lifecycle.workflow.activation_failed')).toBe(
      'Workflow activation failed',
    );
    expect(describeExecutionOperationLabel('task.assessment_resolution_skipped')).toBe(
      'Assessment resolution skipped',
    );
    expect(describeExecutionOperationLabel('task.escalation_depth_exceeded')).toBe(
      'Escalation depth exceeded',
    );
    expect(describeExecutionOperationOption('tool.exec')).toBe('Tool exec · tool.exec');
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

    const next = writeInspectorFilters(
      initial,
      {
        ...DEFAULT_INSPECTOR_FILTERS,
      },
    );

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

  it('MCL-005: formats zero cost as $0.00 and non-zero cost with four decimal places', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(null)).toBe('$0.00');
    expect(formatCost(undefined)).toBe('$0.00');
    expect(formatCost(NaN)).toBe('$0.00');
    expect(formatCost(1.5)).toBe('$1.5000');
    expect(formatCost(0.0012)).toBe('$0.0012');
    expect(formatCost('2.5')).toBe('$2.5000');
  });

  it('describes runtime compaction events as continuity packets', () => {
    const entry = {
      id: 9,
      trace_id: 'trace-9',
      span_id: 'span-9',
      source: 'runtime',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'runtime.context.compaction.completed',
      status: 'completed',
      task_title: 'Implement billing',
      actor_type: 'worker',
      actor_id: 'worker-1',
      actor_name: 'Runtime worker',
      created_at: '2026-03-19T00:00:00Z',
      payload: {
        context_strategy: 'semantic_local',
        trigger: 'context_window',
        tokens_before: 120000,
        tokens_after: 62000,
        tokens_saved: 58000,
        checkpoint_ref: 'context/compaction-checkpoint.json',
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Step Implement billing compacted specialist context',
    );
    expect(describeExecutionOperationLabel(entry.operation)).toBe('Context compaction completed');
    expect(summarizeLogContext(entry)).toEqual([
      'step Implement billing',
      'Context continuity packet',
    ]);
    expect(describeExecutionNextAction(entry)).toBe(
      'Inspect the preserved checkpoint, tokens saved, and recent breadcrumbs before assuming older context is still available.',
    );
    expect(readExecutionSignals(entry)).toEqual(['Continuity', 'Compaction']);
  });

  it('describes activation-finish persistence events as orchestrator continuity packets', () => {
    const entry = {
      id: 10,
      trace_id: 'trace-10',
      span_id: 'span-10',
      source: 'runtime',
      category: 'task_lifecycle',
      level: 'info',
      operation: 'runtime.context.activation_finish.completed',
      status: 'completed',
      workflow_name: 'Delivery',
      activation_id: 'activation-12345678',
      is_orchestrator_task: true,
      actor_type: 'worker',
      actor_id: 'worker-1',
      actor_name: 'Runtime worker',
      created_at: '2026-03-19T00:00:00Z',
      payload: {
        memory_keys_written: ['repo_root'],
        checkpoint_ref: 'context/activation-checkpoint.json',
        continuity_written: true,
      },
    } as const;

    expect(describeExecutionHeadline(entry)).toBe(
      'Orchestrator activity persisted activation checkpoint',
    );
    expect(describeExecutionOperationLabel(entry.operation)).toBe('Activation finish completed');
    expect(summarizeLogContext(entry)).toEqual([
      'workflow Delivery',
      'activation activati',
      'Activation checkpoint packet',
    ]);
    expect(describeExecutionNextAction(entry)).toBe(
      'Confirm the activation checkpoint, continuity update, and durable memory writes before the next orchestrator activation starts.',
    );
    expect(readExecutionSignals(entry)).toEqual([
      'Continuity',
      'Activation checkpoint',
      'Orchestrator',
      'Activation',
    ]);
  });
});
