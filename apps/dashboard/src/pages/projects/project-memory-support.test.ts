import { describe, expect, it } from 'vitest';

import {
  extractMemoryEntries,
  filterMemoryEntries,
  normalizeWorkItemMemoryHistoryEntries,
  normalizeWorkItemMemoryEntries,
  summarizeProjectTimeline,
} from './project-memory-support.js';

describe('project memory support', () => {
  it('extracts project memory entries into table rows', () => {
    expect(
      extractMemoryEntries({
        operator_note: { summary: 'watch deploy' },
        branch: 'feature/v2-cutover',
      }),
    ).toEqual([
      {
        key: 'operator_note',
        value: { summary: 'watch deploy' },
        scope: 'project',
      },
      {
        key: 'branch',
        value: 'feature/v2-cutover',
        scope: 'project',
      },
    ]);
  });

  it('filters memory entries by key and serialized value', () => {
    const entries = extractMemoryEntries({
      operator_note: { summary: 'watch deploy' },
      branch: 'feature/v2-cutover',
    });

    expect(filterMemoryEntries(entries, 'deploy')).toEqual([
      {
        key: 'operator_note',
        value: { summary: 'watch deploy' },
        scope: 'project',
      },
    ]);
  });

  it('normalizes work-item memory entries with workflow context', () => {
    expect(
      normalizeWorkItemMemoryEntries([
        {
          key: 'review_note',
          value: { summary: 'needs tests' },
          event_id: 1,
          updated_at: '2026-03-11T09:00:00.000Z',
          actor_type: 'system',
          actor_id: 'orchestrator',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
          task_id: 'task-1',
          stage_name: 'review',
        },
      ]),
    ).toEqual([
      {
        key: 'review_note',
        value: { summary: 'needs tests' },
        scope: 'work_item',
        eventId: 1,
        workflowId: 'workflow-1',
        workItemId: 'wi-1',
        taskId: 'task-1',
        stageName: 'review',
        actorType: 'system',
        actorId: 'orchestrator',
        updatedAt: '2026-03-11T09:00:00.000Z',
      },
    ]);
  });

  it('normalizes and sorts work-item memory history for operator review', () => {
    expect(
      normalizeWorkItemMemoryHistoryEntries([
        {
          key: 'review_note',
          value: { summary: 'older' },
          event_id: 1,
          updated_at: '2026-03-10T09:00:00.000Z',
          actor_type: 'system',
          actor_id: 'orchestrator',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
          task_id: 'task-1',
          stage_name: 'review',
          event_type: 'updated',
        },
        {
          key: 'review_note',
          value: { summary: 'deleted' },
          event_id: 2,
          updated_at: '2026-03-11T09:00:00.000Z',
          actor_type: 'system',
          actor_id: 'orchestrator',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
          task_id: 'task-2',
          stage_name: 'review',
          event_type: 'deleted',
        },
      ]),
    ).toEqual([
      {
        key: 'review_note',
        value: { summary: 'deleted' },
        scope: 'work_item',
        eventId: 2,
        workflowId: 'workflow-1',
        workItemId: 'wi-1',
        taskId: 'task-2',
        stageName: 'review',
        actorType: 'system',
        actorId: 'orchestrator',
        updatedAt: '2026-03-11T09:00:00.000Z',
        eventType: 'deleted',
      },
      {
        key: 'review_note',
        value: { summary: 'older' },
        scope: 'work_item',
        eventId: 1,
        workflowId: 'workflow-1',
        workItemId: 'wi-1',
        taskId: 'task-1',
        stageName: 'review',
        actorType: 'system',
        actorId: 'orchestrator',
        updatedAt: '2026-03-10T09:00:00.000Z',
        eventType: 'updated',
      },
    ]);
  });

  it('summarizes unique project workflows with normalized continuity states', () => {
    expect(
      summarizeProjectTimeline([
        {
          workflow_id: 'workflow-1',
          name: 'Planning',
          state: 'active',
          created_at: '2026-03-10T10:00:00.000Z',
        },
        {
          workflow_id: 'workflow-1',
          name: 'Planning duplicate',
          state: 'completed',
          created_at: '2026-03-10T11:00:00.000Z',
        },
        {
          workflow_id: 'workflow-2',
          name: 'Delivery',
          state: 'failed',
          created_at: '2026-03-11T09:00:00.000Z',
        },
      ]),
    ).toEqual({
      activeCount: 1,
      totalCount: 2,
      recentWorkflows: [
        {
          id: 'workflow-1',
          name: 'Planning',
          state: 'active',
          createdAt: '2026-03-10T10:00:00.000Z',
        },
        {
          id: 'workflow-2',
          name: 'Delivery',
          state: 'failed',
          createdAt: '2026-03-11T09:00:00.000Z',
        },
      ],
    });
  });
});
