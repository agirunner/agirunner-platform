import { describe, expect, it } from 'vitest';

import {
  buildWorkItemRecoveryBrief,
  buildWorkItemBreadcrumbs,
  describeCountLabel,
  describeTaskOperatorPosture,
  describeWorkItemArtifactIdentity,
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
          state: 'in_progress',
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
        state: 'in_progress',
        role: 'architect',
        work_item_id: 'wi-1',
        stage_name: 'design',
        created_at: undefined,
        completed_at: null,
        depends_on: ['task-0'],
      },
    ]);
  });

  it('keeps canonical claimed tasks distinct from in-progress work in execution summaries', () => {
    expect(
      summarizeWorkItemExecution([
        {
          id: 'task-claimed',
          title: 'Queued specialist',
          state: 'claimed',
          role: 'engineer',
          stage_name: 'implementation',
          completed_at: null,
          depends_on: [],
          work_item_id: 'wi-1',
        },
        {
          id: 'task-running',
          title: 'Active specialist',
          state: 'in_progress',
          role: 'reviewer',
          stage_name: 'review',
          completed_at: null,
          depends_on: [],
          work_item_id: 'wi-1',
        },
      ]),
    ).toEqual({
      totalSteps: 2,
      awaitingOperator: 0,
      retryableSteps: 0,
      activeSteps: 1,
      completedSteps: 0,
      distinctRoles: ['engineer', 'reviewer'],
      distinctStages: ['implementation', 'review'],
    });
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
        state: 'in_progress',
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

  it('formats singular and plural operator count labels correctly', () => {
    expect(describeCountLabel(1, 'linked step')).toBe('1 linked step');
    expect(describeCountLabel(2, 'linked step')).toBe('2 linked steps');
    expect(describeCountLabel(0, 'linked step')).toBe('0 linked steps');
    expect(describeCountLabel(1, 'artifact')).toBe('1 artifact');
    expect(describeCountLabel(1, 'child item')).toBe('1 child item');
    expect(describeCountLabel(3, 'child item')).toBe('3 child items');
    expect(describeCountLabel(1, 'step review')).toBe('1 step review');
    expect(describeCountLabel(4, 'step review')).toBe('4 step reviews');
    expect(describeCountLabel(1, 'failed step')).toBe('1 failed step');
    expect(describeCountLabel(2, 'failed step')).toBe('2 failed steps');
    expect(describeCountLabel(1, 'item')).toBe('1 item');
    expect(describeCountLabel(1, 'previewable output')).toBe('1 previewable output');
  });

  it('describes artifacts with filename-first identity and trimmed logical paths', () => {
    expect(
      describeWorkItemArtifactIdentity(
        'artifact:550e8400-e29b-41d4-a716-446655440000/docs/release-notes.md',
      ),
    ).toEqual({
      fileName: 'release-notes.md',
      displayPath: 'docs/release-notes.md',
    });
    expect(describeWorkItemArtifactIdentity('docs/brief.md')).toEqual({
      fileName: 'brief.md',
      displayPath: 'docs/brief.md',
    });
    expect(describeWorkItemArtifactIdentity('artifact:artifact-1/brief.md')).toEqual({
      fileName: 'brief.md',
      displayPath: null,
    });
    expect(describeWorkItemArtifactIdentity('')).toEqual({
      fileName: 'artifact',
      displayPath: null,
    });
    expect(describeWorkItemArtifactIdentity('standalone.csv')).toEqual({
      fileName: 'standalone.csv',
      displayPath: null,
    });
    expect(
      describeWorkItemArtifactIdentity('abc123-def456-789/deep/nested/summary.json'),
    ).toEqual({
      fileName: 'summary.json',
      displayPath: 'abc123-def456-789/deep/nested/summary.json',
    });
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
      detail: 'Review the specialist output from the work-item flow before the board can advance.',
      tone: 'warning',
    });

    expect(
      describeTaskOperatorPosture({
        id: 'task-failed',
        title: 'Fix change',
        state: 'failed',
        role: 'reviewer',
        stage_name: 'verification',
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-1',
      }),
    ).toEqual({
      title: 'Retry or rework available',
      detail:
        'This step failed; choose retry, rework, or escalation from the work-item flow before progress can continue.',
      tone: 'destructive',
    });

    expect(
      describeTaskOperatorPosture({
        id: 'task-active',
        title: 'Active task',
        state: 'in_progress',
        role: 'reviewer',
        stage_name: 'verification',
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-1',
      }),
    ).toEqual({
      title: 'Execution in flight',
      detail: 'A specialist is actively working this step right now.',
      tone: 'secondary',
    });

    expect(
      describeTaskOperatorPosture({
        id: 'task-unknown',
        title: 'Unknown task',
        state: 'unknown',
        role: 'reviewer',
        stage_name: 'verification',
        completed_at: null,
        depends_on: [],
        work_item_id: 'wi-1',
      }),
    ).toEqual({
      title: 'Execution state recorded',
      detail:
        'Stay in the work-item flow for board context, then open step diagnostics if you need runtime detail.',
      tone: 'outline',
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
        { label: 'Pending review', value: 'No decisions waiting' },
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
          awaitingStepReviews: 0,
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
        { label: 'Pending review', value: 'No decisions waiting' },
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
        { label: 'Pending review', value: 'No decisions waiting' },
        { label: 'Execution coverage', value: 'No linked specialist steps' },
      ],
    });
  });
});
