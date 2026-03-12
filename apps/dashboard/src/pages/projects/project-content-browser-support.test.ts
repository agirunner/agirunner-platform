import { describe, expect, it } from 'vitest';

import {
  filterTasksByWorkItem,
  buildWorkflowOptions,
  normalizeProjectList,
  normalizeTaskOptions,
  normalizeWorkItemOptions,
} from './project-content-browser-support.js';

describe('project content browser support', () => {
  it('normalizes projects from wrapped responses', () => {
    expect(normalizeProjectList({ data: [{ id: 'project-1', name: 'Alpha', slug: 'alpha' }] })).toEqual([
      { id: 'project-1', name: 'Alpha', slug: 'alpha' },
    ]);
  });

  it('deduplicates timeline workflows while preserving first-seen order', () => {
    expect(
      buildWorkflowOptions([
        {
          workflow_id: 'workflow-1',
          name: 'Planning',
          state: 'running',
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
          state: 'pending',
          created_at: '2026-03-11T09:00:00.000Z',
        },
      ]),
    ).toEqual([
      {
        id: 'workflow-1',
        name: 'Planning',
        state: 'active',
        createdAt: '2026-03-10T10:00:00.000Z',
      },
      {
        id: 'workflow-2',
        name: 'Delivery',
        state: 'pending',
        createdAt: '2026-03-11T09:00:00.000Z',
      },
    ]);
  });

  it('normalizes task records from paginated task responses', () => {
    expect(
      normalizeTaskOptions({
        data: [
          {
            id: 'task-1',
            title: 'Review PR',
            state: 'running',
            stage_name: 'review',
            work_item_id: 'wi-1',
            activation_id: 'act-1',
            role: 'reviewer',
            is_orchestrator_task: false,
            created_at: '2026-03-11T09:00:00.000Z',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'task-1',
        title: 'Review PR',
        state: 'in_progress',
        stageName: 'review',
        workItemId: 'wi-1',
        activationId: 'act-1',
        role: 'reviewer',
        isOrchestratorTask: false,
        createdAt: '2026-03-11T09:00:00.000Z',
      },
    ]);
  });

  it('normalizes workflow work item options and filters tasks by work item', () => {
    expect(
      normalizeWorkItemOptions([
        {
          id: 'wi-1',
          workflow_id: 'wf-1',
          stage_name: 'implementation',
          title: 'Build auth',
          column_id: 'active',
          priority: 'high',
        } as never,
      ]),
    ).toEqual([
      {
        id: 'wi-1',
        title: 'Build auth',
        stageName: 'implementation',
        columnId: 'active',
        priority: 'high',
        completedAt: null,
      },
    ]);

    expect(
      filterTasksByWorkItem(
        [
          {
            id: 'task-1',
            title: 'Build auth',
            state: 'claimed',
            stageName: 'implementation',
            workItemId: 'wi-1',
            activationId: null,
            role: 'developer',
            isOrchestratorTask: false,
          },
          {
            id: 'task-2',
            title: 'Review auth',
            state: 'pending',
            stageName: 'review',
            workItemId: 'wi-2',
            activationId: null,
            role: 'reviewer',
            isOrchestratorTask: false,
          },
        ],
        'wi-1',
      ),
    ).toEqual([
      {
        id: 'task-1',
        title: 'Build auth',
        state: 'claimed',
        stageName: 'implementation',
        workItemId: 'wi-1',
        activationId: null,
        role: 'developer',
        isOrchestratorTask: false,
      },
    ]);
  });

  it('normalizes escalation task aliases into v2 task states', () => {
    expect(
      normalizeTaskOptions({
        data: [
          {
            id: 'task-3',
            title: 'Resolve blocker',
            state: 'awaiting_escalation',
            is_orchestrator_task: false,
          },
        ],
      }),
    ).toEqual([
      {
        id: 'task-3',
        title: 'Resolve blocker',
        state: 'escalated',
        stageName: null,
        workItemId: null,
        activationId: null,
        role: null,
        isOrchestratorTask: false,
        createdAt: undefined,
      },
    ]);
  });

  it('preserves canonical claimed tasks instead of collapsing them into in-progress', () => {
    expect(
      normalizeTaskOptions({
        data: [
          {
            id: 'task-4',
            title: 'Queued specialist',
            state: 'claimed',
            is_orchestrator_task: false,
          },
        ],
      }),
    ).toEqual([
      {
        id: 'task-4',
        title: 'Queued specialist',
        state: 'claimed',
        stageName: null,
        workItemId: null,
        activationId: null,
        role: null,
        isOrchestratorTask: false,
        createdAt: undefined,
      },
    ]);
  });
});
