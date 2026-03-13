import { describe, expect, it } from 'vitest';

import {
  buildMemoryOverviewCards,
  describeMemoryNextAction,
  describeRecentWorkflowPosture,
  describeScopeBadge,
} from './memory-browser-page.support.js';

describe('memory-browser-page support', () => {
  it('builds overview cards from memory and workflow counts', () => {
    expect(
      buildMemoryOverviewCards({
        projectEntryCount: 3,
        workItemEntryCount: 2,
        historyEntryCount: 7,
        timelineSummary: {
          activeCount: 1,
          totalCount: 4,
          recentWorkflows: [],
        },
      }),
    ).toEqual([
      {
        label: 'Visible memory',
        value: '5',
        detail: '3 project keys and 2 scoped entries in view.',
      },
      {
        label: 'Project workflows',
        value: '4',
        detail: '1 workflows still active.',
      },
      {
        label: 'Scoped history',
        value: '7',
        detail: 'Revision history is ready for diff review.',
      },
    ]);
  });

  it('guides operators toward the next missing scope decision', () => {
    expect(
      describeMemoryNextAction({
        selectedProjectId: 'project-1',
        selectedWorkflowName: null,
        selectedWorkItemTitle: null,
        projectEntryCount: 2,
        workItemEntryCount: 0,
        filteredProjectEntryCount: 2,
        filteredWorkItemEntryCount: 0,
      }),
    ).toBe('Choose a workflow to narrow project memory down to live board context.');

    expect(
      describeMemoryNextAction({
        selectedProjectId: 'project-1',
        selectedWorkflowName: 'Release hardening',
        selectedWorkItemTitle: 'Fix flaky smoke tests',
        projectEntryCount: 2,
        workItemEntryCount: 1,
        filteredProjectEntryCount: 0,
        filteredWorkItemEntryCount: 0,
      }),
    ).toBe('Adjust the current filters to bring the relevant memory packet back into view.');
  });

  it('reports the right scope badge and recent workflow posture', () => {
    expect(
      describeScopeBadge({
        selectedWorkflowName: null,
        selectedWorkItemTitle: 'Triaged bug',
      }),
    ).toBe('Work-item scope');

    expect(
      describeRecentWorkflowPosture({
        id: 'workflow-1',
        name: 'Weekly review',
        state: 'paused',
        createdAt: '2026-03-12T00:00:00.000Z',
      }),
    ).toBe('Paused workflow; inspect the board before changing shared context.');
  });
});
