import { describe, expect, it } from 'vitest';

import {
  buildWorkItemRecoveryBrief,
  flattenArtifactsByTask,
  sortEventsNewestFirst,
  sortMemoryEntriesByKey,
  sortMemoryHistoryNewestFirst,
} from './workflow-work-item-detail-support.js';

describe('workflow work item detail support recovery', () => {
  it('sorts work item events in reverse chronological order', () => {
    const events = sortEventsNewestFirst([
      {
        id: 'evt-1',
        type: 'work_item.updated',
        entity_type: 'work_item',
        entity_id: 'wi-1',
        actor_type: 'system',
        created_at: '2026-03-10T10:00:00.000Z',
      },
      {
        id: 'evt-2',
        type: 'work_item.created',
        entity_type: 'work_item',
        entity_id: 'wi-1',
        actor_type: 'system',
        created_at: '2026-03-10T09:00:00.000Z',
      },
    ]);

    expect(events.map((event) => event.id)).toEqual(['evt-1', 'evt-2']);
  });

  it('sorts event and artifact timestamps safely when the api layer supplies Date values', () => {
    const events = sortEventsNewestFirst([
      {
        id: 'evt-date-1',
        type: 'work_item.updated',
        entity_type: 'work_item',
        entity_id: 'wi-1',
        actor_type: 'system',
        created_at: new Date('2026-03-10T10:00:00.000Z') as unknown as string,
      },
      {
        id: 'evt-date-2',
        type: 'work_item.created',
        entity_type: 'work_item',
        entity_id: 'wi-1',
        actor_type: 'system',
        created_at: new Date('2026-03-10T09:00:00.000Z') as unknown as string,
      },
    ]);
    const artifacts = flattenArtifactsByTask(
      [
        {
          id: 'task-1',
          title: 'Draft design',
          state: 'completed',
          role: null,
          stage_name: null,
          completed_at: null,
          depends_on: [],
          work_item_id: 'wi-1',
        },
      ],
      [
        [
          {
            id: 'artifact-older',
            task_id: 'task-1',
            logical_path: 'docs/older.md',
            content_type: 'text/markdown',
            size_bytes: 64,
            checksum_sha256: 'sha-1',
            metadata: {},
            retention_policy: {},
            created_at: new Date('2026-03-10T09:00:00.000Z') as unknown as string,
            download_url: '/download/older',
          },
          {
            id: 'artifact-newer',
            task_id: 'task-1',
            logical_path: 'docs/newer.md',
            content_type: 'text/markdown',
            size_bytes: 64,
            checksum_sha256: 'sha-2',
            metadata: {},
            retention_policy: {},
            created_at: new Date('2026-03-10T10:00:00.000Z') as unknown as string,
            download_url: '/download/newer',
          },
        ],
      ],
    );

    expect(events.map((event) => event.id)).toEqual(['evt-date-1', 'evt-date-2']);
    expect(artifacts.map((artifact) => artifact.id)).toEqual(['artifact-newer', 'artifact-older']);
  });

  it('sorts work-item memory entries by key and history by most recent event', () => {
    const entries = sortMemoryEntriesByKey([
      {
        key: 'zeta',
        value: { done: true },
        event_id: 2,
        updated_at: '2026-03-10T10:00:00.000Z',
        actor_type: 'agent',
        actor_id: 'agent-1',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        task_id: null,
        stage_name: 'build',
      },
      {
        key: 'alpha',
        value: { done: false },
        event_id: 1,
        updated_at: '2026-03-10T09:00:00.000Z',
        actor_type: 'agent',
        actor_id: 'agent-1',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        task_id: null,
        stage_name: 'build',
      },
    ]);
    const history = sortMemoryHistoryNewestFirst([
      {
        key: 'notes',
        value: { text: 'older' },
        event_id: 3,
        event_type: 'updated',
        updated_at: '2026-03-10T08:00:00.000Z',
        actor_type: 'agent',
        actor_id: 'agent-1',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        task_id: null,
        stage_name: 'design',
      },
      {
        key: 'notes',
        value: { text: 'newer' },
        event_id: 4,
        event_type: 'deleted',
        updated_at: '2026-03-10T09:00:00.000Z',
        actor_type: 'agent',
        actor_id: 'agent-1',
        workflow_id: 'wf-1',
        work_item_id: 'wi-1',
        task_id: null,
        stage_name: 'design',
      },
    ]);

    expect(entries.map((entry) => entry.key)).toEqual(['alpha', 'zeta']);
    expect(history.map((entry) => entry.event_id)).toEqual([4, 3]);
  });

  it('prioritizes failed and escalated steps in the work-item recovery brief', () => {
    expect(
      buildWorkItemRecoveryBrief({
        workItem: {
          id: 'wi-1',
          workflow_id: 'wf-1',
          parent_work_item_id: null,
          stage_name: 'implementation',
          title: 'Fix deploy',
          column_id: 'active',
          priority: 'high',
          owner_role: 'engineer',
        },
        executionSummary: {
          totalSteps: 3,
          awaitingOperator: 0,
          retryableSteps: 2,
          activeSteps: 1,
          completedSteps: 0,
          distinctRoles: ['engineer'],
          distinctStages: ['implementation'],
        },
      }),
    ).toEqual({
      title: 'Recover failed execution first',
      summary:
        '2 linked steps failed or escalated. Retry, rework, or resolve the escalation before changing lower-risk routing or notes.',
      tone: 'destructive',
      badge: 'Recovery blocking',
      facts: [
        { label: 'Board routing', value: 'implementation / active' },
        { label: 'Owner role', value: 'engineer' },
        { label: 'Pending decisions', value: 'No decisions waiting' },
        { label: 'Execution coverage', value: '1 active / 0 complete' },
      ],
    });
  });

  it('requires milestone decomposition before specialist execution exists', () => {
    expect(
      buildWorkItemRecoveryBrief({
        workItem: {
          id: 'wi-parent',
          workflow_id: 'wf-1',
          parent_work_item_id: null,
          stage_name: 'implementation',
          title: 'Release milestone',
          column_id: 'active',
          priority: 'normal',
          is_milestone: true,
        },
        executionSummary: {
          totalSteps: 0,
          awaitingOperator: 0,
          retryableSteps: 0,
          activeSteps: 0,
          completedSteps: 0,
          distinctRoles: [],
          distinctStages: [],
        },
        milestoneSummary: {
          totalChildren: 0,
          completedChildren: 0,
          openChildren: 0,
          awaitingStepDecisions: 0,
          failedSteps: 0,
          inFlightSteps: 0,
          activeStageNames: [],
          activeColumnIds: [],
        },
      }),
    ).toEqual({
      title: 'Break this milestone into child work items',
      summary:
        'Milestones only become actionable once they carry child work. Create at least one child item before expecting specialist execution to show up here.',
      tone: 'warning',
      badge: 'Needs decomposition',
      facts: [
        { label: 'Board routing', value: 'implementation / active' },
        { label: 'Owner role', value: 'Unassigned' },
        { label: 'Pending decisions', value: 'No decisions waiting' },
        { label: 'Milestone scope', value: '0 open / 0 child items' },
      ],
    });
  });

  it('surfaces routing gaps before a step-free work item can be scheduled', () => {
    expect(
      buildWorkItemRecoveryBrief({
        workItem: {
          id: 'wi-1',
          workflow_id: 'wf-1',
          parent_work_item_id: null,
          stage_name: '',
          title: 'Draft rollout note',
          column_id: '',
          priority: 'normal',
        },
        executionSummary: {
          totalSteps: 0,
          awaitingOperator: 0,
          retryableSteps: 0,
          activeSteps: 0,
          completedSteps: 0,
          distinctRoles: [],
          distinctStages: [],
        },
      }),
    ).toEqual({
      title: 'Restore board routing',
      summary:
        'This work item is missing stage routing and board placement. Set both so operators and specialists stay aligned on where this packet belongs.',
      tone: 'warning',
      badge: 'Routing incomplete',
      facts: [
        { label: 'Board routing', value: 'Missing stage / Missing board column' },
        { label: 'Owner role', value: 'Unassigned' },
        { label: 'Pending decisions', value: 'No decisions waiting' },
        { label: 'Execution coverage', value: 'No linked specialist steps' },
      ],
    });
  });
});
