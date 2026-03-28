import { describe, expect, it } from 'vitest';

import { summarizeTaskPreviewsForWorkItem } from './workflow-board-task-preview.js';

describe('summarizeTaskPreviewsForWorkItem', () => {
  it('drops task rows that belong to a different work item', () => {
    const previewSummary = summarizeTaskPreviewsForWorkItem(
      [
        {
          id: 'task-correct',
          title: 'Correct task',
          role: 'analyst',
          state: 'completed',
          work_item_id: 'work-item-1',
        },
        {
          id: 'task-wrong',
          title: 'Wrong task',
          role: 'assessor',
          state: 'in_progress',
          work_item_id: 'work-item-2',
        },
      ],
      'work-item-1',
    );

    expect(previewSummary).toEqual({
      tasks: [
        {
          id: 'task-correct',
          title: 'Correct task',
          role: 'analyst',
          state: 'completed',
          workItemId: 'work-item-1',
          workItemTitle: null,
          stageName: null,
        },
      ],
      hasActiveOrchestratorTask: false,
    });
  });

  it('filters orchestrator tasks out of the visible stack while surfacing orchestration activity', () => {
    const previewSummary = summarizeTaskPreviewsForWorkItem(
      [
        {
          id: 'task-specialist',
          title: 'Assess packet',
          role: 'policy-assessor',
          state: 'ready',
          work_item_id: 'work-item-1',
          is_orchestrator_task: false,
        },
        {
          id: 'task-orchestrator',
          title: 'Orchestrate workflow',
          role: 'orchestrator',
          state: 'in_progress',
          work_item_id: 'work-item-1',
          is_orchestrator_task: true,
        },
      ],
      'work-item-1',
    );

    expect(previewSummary).toEqual({
      tasks: [
        {
          id: 'task-specialist',
          title: 'Assess packet',
          role: 'policy-assessor',
          state: 'ready',
          workItemId: 'work-item-1',
          workItemTitle: null,
          stageName: null,
        },
      ],
      hasActiveOrchestratorTask: true,
    });
  });

  it('drops tasks that do not declare an owning work item instead of assigning them to the current card', () => {
    const previewSummary = summarizeTaskPreviewsForWorkItem(
      [
        {
          id: 'task-missing-owner',
          title: 'Unknown owner',
          role: 'analyst',
          state: 'ready',
        },
      ],
      'work-item-1',
    );

    expect(previewSummary).toEqual({
      tasks: [],
      hasActiveOrchestratorTask: false,
    });
  });
});
