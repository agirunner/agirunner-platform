import { describe, expect, it } from 'vitest';

import {
  describeExecutionHeadline,
  describeExecutionNextAction,
  describeExecutionSummary,
  readExecutionSignals,
  summarizeLogContext,
} from './execution-inspector-support.js';

describe('execution inspector presentation support', () => {
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
      }),
    ).toEqual([
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
    expect(readExecutionSignals(entry)).toEqual(['Continuity', 'Activation', 'Work item', 'Stage']);
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
});
