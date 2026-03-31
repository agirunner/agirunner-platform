import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  buildWorkItemRecoveryBrief,
  summarizeWorkItemExecution,
  type DashboardGroupedWorkItemRecord,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';
import { WorkItemRecoveryBriefSection } from './workflow-work-item-recovery-brief.js';

describe('workflow work-item recovery brief', () => {
  it('renders recovery actions without object leakage', () => {
    const tasks = createTasks();
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkItemRecoveryBriefSection, {
          brief: buildWorkItemRecoveryBrief({
            workItem: createWorkItem(),
            executionSummary: summarizeWorkItemExecution(tasks),
            milestoneSummary: null,
          }),
          workflowId: 'workflow-1',
          workItemId: 'work-item-1',
          tasks,
          onWorkItemChanged: async () => undefined,
        }),
      ),
    );

    expect(markup).toContain('Recovery brief');
    expect(markup).toContain('Retry Work Item');
    expect(markup).toContain('Skip Work Item');
    expect(markup).toContain('Board-owned step recovery');
    expect(markup).not.toContain('[object Object]');
  });
});

function createWorkItem(): DashboardGroupedWorkItemRecord {
  return {
    id: 'work-item-1',
    workflow_id: 'workflow-1',
    title: 'Stabilize release candidate',
    column_id: 'active',
    priority: 'high',
    stage_name: 'qa',
  } as DashboardGroupedWorkItemRecord;
}

function createTasks(): DashboardWorkItemTaskRecord[] {
  return [
    {
      id: 'task-1',
      title: 'Repair failed smoke signal',
      state: 'failed',
      role: 'qa_specialist',
      stage_name: 'qa',
      work_item_id: 'work-item-1',
      depends_on: [],
    },
  ] as DashboardWorkItemTaskRecord[];
}
