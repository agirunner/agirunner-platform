import { describe, expect, it, vi } from 'vitest';

import {
  invalidateWorkflowRealtimeProjectionQueries,
  invalidateWorkflowRealtimeQueriesOnReconnect,
} from './workflows-realtime.query-invalidation.js';

describe('invalidateWorkflowRealtimeProjectionQueries', () => {
  it('invalidates the workspace and visible work-item queries when the workspace board refreshes', () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };

    invalidateWorkflowRealtimeProjectionQueries(queryClient, {
      workflowId: 'workflow-1',
      selectedWorkItemId: 'work-item-7',
      batch: {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'workspace_board_update',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              columns: [],
              work_items: [],
              active_stages: [],
              awaiting_gate_count: 0,
              stage_summary: [],
            },
          },
        ],
      },
    });

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['workflows', 'workspace', 'workflow-1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['workflows', 'work-item-detail', 'workflow-1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ['workflows', 'work-item-tasks', 'workflow-1'],
    });
  });

  it('ignores console-only workflow batches that are not tied to any work item', () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };

    invalidateWorkflowRealtimeProjectionQueries(queryClient, {
      workflowId: 'workflow-1',
      selectedWorkItemId: 'work-item-7',
      batch: {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'live_console_append',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              items: [],
              counts: { all: 1, turn_updates: 1, briefs: 0, steering: 0 },
              next_cursor: null,
            },
          },
        ],
      },
    });

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('invalidates the workspace plus the touched work-item detail and task queries when incremental activity targets that work item', () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };

    invalidateWorkflowRealtimeProjectionQueries(queryClient, {
      workflowId: 'workflow-1',
      selectedWorkItemId: null,
      batch: {
        generated_at: '2026-03-30T12:01:00.000Z',
        latest_event_id: 12,
        snapshot_version: 'workflow-operations:12',
        cursor: 'workflow-operations:12',
        events: [
          {
            event_type: 'live_console_append',
            cursor: 'workflow-operations:12',
            snapshot_version: 'workflow-operations:12',
            workflow_id: 'workflow-1',
            payload: {
              items: [
                {
                  item_id: 'console-1',
                  item_kind: 'task_turn_update',
                  source_kind: 'specialist',
                  source_label: 'Policy Analyst',
                  headline: 'Updated scope map',
                  summary: 'Updated scope map',
                  created_at: '2026-03-30T12:01:00.000Z',
                  work_item_id: 'work-item-7',
                  task_id: 'task-9',
                  linked_target_ids: [],
                  scope_binding: 'record',
                },
              ],
              counts: { all: 1, turn_updates: 1, briefs: 0, steering: 0 },
              next_cursor: null,
            },
          },
        ],
      },
    });

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['workflows', 'workspace', 'workflow-1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['workflows', 'work-item-detail', 'workflow-1', 'work-item-7'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ['workflows', 'work-item-tasks', 'workflow-1', 'work-item-7'],
    });
  });
});

describe('invalidateWorkflowRealtimeQueriesOnReconnect', () => {
  it('invalidates the workflow workspace and all work-item projections after a stream gap', () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };

    invalidateWorkflowRealtimeQueriesOnReconnect(queryClient, 'workflow-1');

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['workflows', 'workspace', 'workflow-1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['workflows', 'work-item-detail', 'workflow-1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ['workflows', 'work-item-tasks', 'workflow-1'],
    });
  });
});
