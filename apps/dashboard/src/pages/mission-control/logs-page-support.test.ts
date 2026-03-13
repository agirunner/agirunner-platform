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
      headline: 'Step Review smoke result completed Task awaiting approval',
      summary: 'board Board Alpha • stage qa • work item workitem • activation activati • Recorded by QA Agent • via runtime • task lifecycle',
      nextAction: 'Review this warning before it turns into a gate or board blocker.',
      context: ['board Board Alpha', 'step Review smoke result', 'stage qa', 'work item workitem', 'activation activati'],
      signals: ['Activation', 'Work item', 'Stage'],
      createdAtLabel: '15m ago',
      createdAtIso: '2026-03-12T22:00:00.000Z',
      createdAtDetail: new Date('2026-03-12T22:00:00.000Z').toLocaleString(),
      workflowContextHref:
        '/work/workflows/workflow-12345678?work_item=workitem-88888888&activation=activation-9999',
      taskRecordHref: '/work/tasks/task-abcdef12',
    });
  });
});
