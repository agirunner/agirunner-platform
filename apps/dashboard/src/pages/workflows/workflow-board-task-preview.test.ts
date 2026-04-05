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
          isOrchestratorTask: false,
          recentUpdate: null,
          workItemId: 'work-item-1',
          workItemTitle: null,
          stageName: null,
        },
      ],
      hasActiveOrchestratorTask: false,
    });
  });

  it('keeps active orchestrator tasks in the visible stack while surfacing orchestration activity', () => {
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
          id: 'task-orchestrator',
          title: 'Orchestrate workflow',
          role: 'orchestrator',
          state: 'in_progress',
          isOrchestratorTask: true,
          recentUpdate: null,
          workItemId: 'work-item-1',
          workItemTitle: null,
          stageName: null,
        },
        {
          id: 'task-specialist',
          title: 'Assess packet',
          role: 'policy-assessor',
          state: 'ready',
          isOrchestratorTask: false,
          recentUpdate: null,
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

  it('keeps operator-facing task input summaries while stripping opaque reference fields', () => {
    const previewSummary = summarizeTaskPreviewsForWorkItem(
      [
        {
          id: 'task-readable',
          title: 'Draft operator brief',
          role: 'mixed-reviewer',
          state: 'in_progress',
          summary: 'Turning the request into a reviewable packet.',
          work_item_id: 'work-item-1',
          input: {
            deliverable: 'A concise operator brief for the final approval pass.',
            acceptance_criteria: 'Highlight open risks and confirm the release packet is ready.',
            subject_task_id: 'task-hidden',
            artifact_id: 'artifact-hidden',
            checklist: ['legal_review', 'policy-pass'],
          },
        },
      ],
      'work-item-1',
    );

    expect(previewSummary).toEqual({
      tasks: [
        {
          id: 'task-readable',
          title: 'Draft operator brief',
          role: 'mixed-reviewer',
          state: 'in_progress',
          isOrchestratorTask: false,
          recentUpdate: 'Turning the request into a reviewable packet.',
          workItemId: 'work-item-1',
          workItemTitle: null,
          stageName: null,
          operatorSummary: [
            'Requested deliverable: A concise operator brief for the final approval pass.',
            'Success criteria: Highlight open risks and confirm the release packet is ready.',
            'Checklist: Legal Review • Policy Pass',
          ],
        },
      ],
      hasActiveOrchestratorTask: false,
    });
  });
});
