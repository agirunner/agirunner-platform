import { describe, expect, it } from 'vitest';

import {
  buildWorkItemBreadcrumbs,
  describeTaskOperatorPosture,
  findWorkItemById,
  flattenArtifactsByTask,
  flattenGroupedWorkItems,
  groupWorkflowWorkItems,
  isMilestoneWorkItem,
  normalizeWorkItemTasks,
  selectTasksForWorkItem,
  sortTasksForOperatorReview,
  summarizeStructuredValue,
  summarizeWorkItemExecution,
  summarizeMilestoneOperatorFlow,
  sortMemoryEntriesByKey,
  sortMemoryHistoryNewestFirst,
  sortEventsNewestFirst,
} from './workflow-work-item-detail-support.js';

describe('workflow work item detail support', () => {
  it('normalizes wrapped task responses and preserves work item linkage', () => {
    const tasks = normalizeWorkItemTasks({
      data: [
        {
          id: 'task-1',
          title: 'Draft design',
          state: 'completed',
          role: 'architect',
          work_item_id: 'wi-1',
          stage_name: 'design',
          depends_on: ['task-0'],
        },
      ],
    });

    expect(tasks).toEqual([
      {
        id: 'task-1',
        title: 'Draft design',
        state: 'completed',
        role: 'architect',
        work_item_id: 'wi-1',
        stage_name: 'design',
        created_at: undefined,
        completed_at: null,
        depends_on: ['task-0'],
      },
    ]);
  });

  it('filters tasks and flattens artifacts for the selected work item', () => {
    const tasks = [
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
      {
        id: 'task-2',
        title: 'Review design',
        state: 'running',
        role: null,
        stage_name: null,
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-2',
      },
    ];

    const selected = selectTasksForWorkItem(tasks, 'wi-1');
    const artifacts = flattenArtifactsByTask(selected, [
      [
        {
          id: 'artifact-1',
          task_id: 'task-1',
          logical_path: 'docs/design.md',
          content_type: 'text/markdown',
          size_bytes: 1024,
          checksum_sha256: 'sha',
          metadata: {},
          retention_policy: {},
          created_at: '2026-03-10T12:00:00.000Z',
          download_url: '/download/1',
        },
      ],
    ]);

    expect(selected).toHaveLength(1);
    expect(artifacts).toEqual([
      expect.objectContaining({
        id: 'artifact-1',
        task_title: 'Draft design',
      }),
    ]);
  });

  it('groups parent milestone work items, finds them by id, and selects child tasks with the parent', () => {
    const grouped = groupWorkflowWorkItems([
      {
        id: 'wi-parent',
        workflow_id: 'wf-1',
        parent_work_item_id: null,
        stage_name: 'implementation',
        title: 'Auth milestone',
        column_id: 'active',
        priority: 'high',
        children_count: 1,
      },
      {
        id: 'wi-child-1',
        workflow_id: 'wf-1',
        parent_work_item_id: 'wi-parent',
        stage_name: 'implementation',
        title: 'Auth implementation',
        column_id: 'active',
        priority: 'normal',
      },
    ]);
    const tasks = [
      {
        id: 'task-1',
        title: 'Plan milestone',
        state: 'completed',
        role: null,
        stage_name: null,
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-parent',
      },
      {
        id: 'task-2',
        title: 'Implement auth',
        state: 'in_progress',
        role: null,
        stage_name: null,
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-child-1',
      },
    ];

    expect(grouped).toHaveLength(1);
    expect(flattenGroupedWorkItems(grouped).map((item) => item.id)).toEqual([
      'wi-parent',
      'wi-child-1',
    ]);
    expect(findWorkItemById(grouped, 'wi-child-1')?.title).toBe('Auth implementation');
    expect(isMilestoneWorkItem(grouped[0])).toBe(true);
    expect(selectTasksForWorkItem(tasks, 'wi-parent', grouped).map((task) => task.id)).toEqual([
      'task-1',
      'task-2',
    ]);
    expect(buildWorkItemBreadcrumbs(grouped, 'wi-child-1')).toEqual([
      'Auth milestone',
      'Auth implementation',
    ]);
  });

  it('summarizes grouped milestone operator flow for child work items and linked steps', () => {
    const summary = summarizeMilestoneOperatorFlow(
      [
        {
          id: 'wi-child-1',
          workflow_id: 'wf-1',
          parent_work_item_id: 'wi-parent',
          stage_name: 'implementation',
          title: 'Auth implementation',
          column_id: 'active',
          priority: 'normal',
          completed_at: null,
        },
        {
          id: 'wi-child-2',
          workflow_id: 'wf-1',
          parent_work_item_id: 'wi-parent',
          stage_name: 'verification',
          title: 'Auth verification',
          column_id: 'review',
          priority: 'normal',
          completed_at: '2026-03-12T10:00:00.000Z',
        },
      ],
      [
        {
          id: 'task-1',
          title: 'Implement auth',
          state: 'in_progress',
          role: null,
          stage_name: 'implementation',
          completed_at: null,
          depends_on: [],
          work_item_id: 'wi-child-1',
        },
        {
          id: 'task-2',
          title: 'Review auth',
          state: 'awaiting_approval',
          role: null,
          stage_name: 'verification',
          completed_at: null,
          depends_on: [],
          work_item_id: 'wi-child-2',
        },
        {
          id: 'task-3',
          title: 'Fix auth',
          state: 'failed',
          role: null,
          stage_name: 'implementation',
          completed_at: null,
          depends_on: [],
          work_item_id: 'wi-child-1',
        },
      ],
    );

    expect(summary).toEqual({
      totalChildren: 2,
      completedChildren: 1,
      openChildren: 1,
      awaitingStepReviews: 1,
      failedSteps: 1,
      inFlightSteps: 1,
      activeStageNames: ['implementation', 'verification'],
      activeColumnIds: ['active', 'review'],
    });
  });

  it('summarizes execution posture and sorts tasks by operator urgency', () => {
    const tasks = [
      {
        id: 'task-3',
        title: 'Ship change',
        state: 'completed',
        role: 'developer',
        stage_name: 'delivery',
        completed_at: '2026-03-12T11:00:00.000Z',
        depends_on: [],
        work_item_id: 'wi-1',
      },
      {
        id: 'task-1',
        title: 'Review change',
        state: 'awaiting_approval',
        role: 'reviewer',
        stage_name: 'verification',
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-1',
      },
      {
        id: 'task-2',
        title: 'Fix change',
        state: 'failed',
        role: 'developer',
        stage_name: 'implementation',
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-1',
      },
      {
        id: 'task-4',
        title: 'Draft change',
        state: 'in_progress',
        role: 'developer',
        stage_name: 'implementation',
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-1',
      },
    ];

    expect(summarizeWorkItemExecution(tasks)).toEqual({
      totalSteps: 4,
      awaitingOperator: 1,
      retryableSteps: 1,
      activeSteps: 1,
      completedSteps: 1,
      distinctRoles: ['developer', 'reviewer'],
      distinctStages: ['delivery', 'implementation', 'verification'],
    });
    expect(sortTasksForOperatorReview(tasks).map((task) => task.id)).toEqual([
      'task-1',
      'task-2',
      'task-4',
      'task-3',
    ]);
  });

  it('describes task operator posture and structured payload summaries for review packets', () => {
    expect(
      describeTaskOperatorPosture({
        id: 'task-1',
        title: 'Review change',
        state: 'output_pending_review',
        role: 'reviewer',
        stage_name: 'verification',
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-1',
      }),
    ).toEqual({
      title: 'Output review needed',
      detail: 'Review the specialist output before the board can advance.',
      tone: 'warning',
    });

    expect(
      summarizeStructuredValue({
        summary: 'Implement auth flow',
        stage_name: 'implementation',
        owner_role: 'developer',
        nested: { retry_count: 1 },
      }),
    ).toEqual({
      hasValue: true,
      shapeLabel: '4 fields',
      detail: 'Includes nested, owner role, stage name, summary.',
      keyHighlights: ['nested', 'owner role', 'stage name', 'summary'],
      scalarFacts: [
        { label: 'owner role', value: 'developer' },
        { label: 'stage name', value: 'implementation' },
        { label: 'summary', value: 'Implement auth flow' },
      ],
    });
  });

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
});
