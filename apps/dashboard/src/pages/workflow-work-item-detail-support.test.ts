import { describe, expect, it } from 'vitest';

import {
  findWorkItemById,
  flattenArtifactsByTask,
  flattenGroupedWorkItems,
  groupWorkflowWorkItems,
  isMilestoneWorkItem,
  normalizeWorkItemTasks,
  selectTasksForWorkItem,
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
