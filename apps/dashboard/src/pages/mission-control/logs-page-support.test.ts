import { describe, expect, it } from 'vitest';

import { DEFAULT_INSPECTOR_FILTERS } from '../../components/execution-inspector-support.js';
import {
  buildInspectorOverviewCards,
  buildRecentLogActivityPackets,
} from './logs-page-support.js';

describe('logs page support', () => {
  it('builds operator-first inspector overview cards', () => {
    const cards = buildInspectorOverviewCards(
      {
        ...DEFAULT_INSPECTOR_FILTERS,
        stageName: 'review',
        level: 'warn',
        timeWindowHours: '6',
      },
      '',
      {
        data: {
          totals: {
            count: 40,
            error_count: 5,
            total_duration_ms: 32_000,
          },
          groups: [
            {
              group: 'tool',
              count: 20,
              error_count: 5,
              avg_duration_ms: 1_000,
              total_duration_ms: 20_000,
              agg: { total_cost_usd: 1.25 },
            },
          ],
        },
      },
      [{ operation: 'tool.exec', count: 12 }],
    );

    expect(cards).toEqual([
      {
        title: 'Focus',
        value: 'Stage review',
        detail: '6h window • warnings and errors',
      },
      {
        title: 'Attention',
        value: '5 errors',
        detail: '13% of 40 entries need review',
      },
      {
        title: 'Spend signal',
        value: '$1.2500',
        detail: '32.00 s recorded runtime',
      },
    ]);
  });

  it('falls back to top activity when the current slice is healthy', () => {
    const cards = buildInspectorOverviewCards(
      DEFAULT_INSPECTOR_FILTERS,
      'workflow-123456789',
      {
        data: {
          totals: {
            count: 18,
            error_count: 0,
            total_duration_ms: 500,
          },
          groups: [],
        },
      },
      [{ operation: 'llm.chat', count: 9 }],
    );

    expect(cards[0]).toEqual({
      title: 'Focus',
      value: 'Board workflow',
      detail: '1d window • info and above',
    });
    expect(cards[1]).toEqual({
      title: 'Attention',
      value: 'Healthy slice',
      detail: 'LLM chat leads with 9 entries',
    });
  });

  it('builds human-readable recent activity packets for the raw logs surface', () => {
    const packets = buildRecentLogActivityPackets([
      {
        id: 44,
        trace_id: 'trace-12345678',
        span_id: 'span-87654321',
        source: 'runtime',
        category: 'task_lifecycle',
        level: 'warn',
        operation: 'task.awaiting_approval',
        status: 'completed',
        duration_ms: 1500,
        workflow_id: 'workflow-12345678',
        workflow_name: 'Board Alpha',
        task_id: 'task-abcdef12',
        task_title: 'Review smoke result',
        work_item_id: 'workitem-88888888',
        stage_name: 'qa',
        activation_id: 'activation-9999',
        actor_type: 'agent',
        actor_id: 'agent-7',
        actor_name: 'QA Agent',
        created_at: '2026-03-12T22:00:00.000Z',
      },
    ], 3, new Date('2026-03-12T22:15:00.000Z').getTime());

    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({
      id: 44,
      actorLabel: 'QA Agent',
      emphasisLabel: 'Needs review',
      emphasisTone: 'warning',
      narrativeHeadline: 'QA Agent completed Review smoke result',
      summary: 'board Board Alpha • stage qa • work item workitem • activation activati • Recorded by QA Agent • via runtime • task lifecycle',
      whyItMatters:
        'This packet carries review pressure that can turn into gate or board drag if it sits unresolved.',
      outcomeLabel: 'Execution completed without runtime errors.',
      nextAction: 'Review this warning before it turns into a gate or board blocker.',
      scopeSummary: 'Board Alpha • Stage qa • Work item workitem • Activation activati',
      facts: [
        {
          label: 'Outcome',
          value: 'Execution completed without runtime errors.',
        },
        {
          label: 'Scope',
          value: 'Board Alpha • Stage qa • Work item workitem • Activation activati',
        },
        {
          label: 'Next step',
          value: 'Review this warning before it turns into a gate or board blocker.',
        },
      ],
      context: ['board Board Alpha', 'step Review smoke result', 'stage qa', 'work item workitem', 'activation activati'],
      signals: ['Activation', 'Work item', 'Stage'],
      supportingContext: [
        'Activation',
        'Work item',
        'Stage',
        'board Board Alpha',
        'step Review smoke result',
        'stage qa',
        'work item workitem',
        'activation activati',
      ],
      createdAtLabel: '15m ago',
      createdAtIso: '2026-03-12T22:00:00.000Z',
      createdAtDetail: new Date('2026-03-12T22:00:00.000Z').toLocaleString(),
      actions: [
        {
          href: '/work/boards/workflow-12345678?work_item=workitem-88888888&activation=activation-9999',
          label: 'Board context',
        },
        {
          href: '/work/tasks/task-abcdef12',
          label: 'Step diagnostics',
        },
      ],
    });
  });

  it('renders task context attachments as continuity packets', () => {
    const packets = buildRecentLogActivityPackets([
      {
        id: 45,
        trace_id: 'trace-23456789',
        span_id: 'span-98765432',
        source: 'platform',
        category: 'task_lifecycle',
        level: 'info',
        operation: 'task.context.attachments',
        status: 'completed',
        duration_ms: 1200,
        workflow_id: 'workflow-12345678',
        workflow_name: 'Board Alpha',
        task_id: 'task-abcdef12',
        task_title: 'Review smoke result',
        work_item_id: 'workitem-88888888',
        stage_name: 'qa',
        activation_id: 'activation-9999',
        actor_type: 'agent',
        actor_id: 'agent-7',
        actor_name: 'QA Agent',
        created_at: '2026-03-12T22:00:00.000Z',
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
      },
    ], 3, new Date('2026-03-12T22:15:00.000Z').getTime());

    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({
      actorLabel: 'QA Agent',
      emphasisLabel: 'Continuity packet',
      emphasisTone: 'success',
      narrativeHeadline: 'QA Agent recorded continuity packet for Review smoke result',
      outcomeLabel: 'Continuity packet recorded.',
      nextAction: 'Review the continuity packet before the next actor resumes the step.',
      scopeSummary: 'Board Alpha • Stage qa • Work item workitem • Activation activati',
      signals: ['Continuity', 'Activation', 'Work item', 'Stage'],
    });
    expect(packets[0].supportingContext).toEqual([
      'Continuity packet',
      'task context attachments',
      'predecessor handoff source local_work_item',
      'recent handoffs 1',
      'work item continuity',
      'project memory index',
      'project artifact index',
      'board Board Alpha',
      'step Review smoke result',
      'stage qa',
      'work item workitem',
      'activation activati',
    ]);
  });

  it('renders predecessor handoff attachments as continuity packets', () => {
    const packets = buildRecentLogActivityPackets([
      {
        id: 46,
        trace_id: 'trace-23456790',
        span_id: 'span-98765433',
        source: 'platform',
        category: 'task_lifecycle',
        level: 'info',
        operation: 'task.context.predecessor_handoff.attach',
        status: 'completed',
        duration_ms: 1200,
        workflow_id: 'workflow-12345678',
        workflow_name: 'Board Alpha',
        task_id: 'task-abcdef12',
        task_title: 'Review smoke result',
        work_item_id: 'workitem-88888888',
        stage_name: 'qa',
        activation_id: 'activation-9999',
        actor_type: 'agent',
        actor_id: 'agent-7',
        actor_name: 'QA Agent',
        created_at: '2026-03-12T22:00:00.000Z',
        payload: {
          current_workflow_id: 'workflow-12345678',
          current_work_item_id: 'workitem-88888888',
          current_task_id: 'task-abcdef12',
          resolution_source: 'local_work_item',
          has_predecessor_handoff: true,
          candidate_handoff_ids: ['handoff-ctx-1'],
          candidate_task_ids: ['task-upstream-1'],
          selected_handoff_id: 'handoff-ctx-1',
          selected_handoff_workflow_id: 'workflow-12345678',
          selected_handoff_work_item_id: 'workitem-88888888',
          selected_handoff_role: 'developer',
          selected_handoff_sequence: 4,
        },
      },
    ], 3, new Date('2026-03-12T22:15:00.000Z').getTime());

    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({
      actorLabel: 'QA Agent',
      emphasisLabel: 'Predecessor handoff',
      emphasisTone: 'success',
      narrativeHeadline: 'QA Agent attached predecessor handoff for Review smoke result',
      outcomeLabel: 'Predecessor handoff attached.',
      nextAction: 'Confirm the selected handoff before the step resumes.',
      scopeSummary: 'Board Alpha • Stage qa • Work item workitem • Activation activati',
      signals: ['Continuity', 'Handoff', 'Activation', 'Work item', 'Stage'],
    });
    expect(packets[0].supportingContext).toEqual([
      'Predecessor handoff packet',
      'selected role developer',
      'selected sequence 4',
      'resolution source local_work_item',
      'board Board Alpha',
      'step Review smoke result',
      'stage qa',
      'work item workitem',
      'activation activati',
    ]);
  });
});
