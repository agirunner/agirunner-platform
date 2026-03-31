import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowStageRecord } from '../../lib/api.js';
import {
  MilestoneChildrenSection,
  MilestoneOperatorSummarySection,
  WorkItemFocusPacket,
  WorkItemHeader,
  WorkItemReviewClosure,
} from './workflow-work-item-summary-sections.js';
import {
  summarizeWorkItemExecution,
  type DashboardGroupedWorkItemRecord,
  type DashboardWorkItemTaskRecord,
} from './workflow-work-item-detail-support.js';

describe('workflow work-item summary sections', () => {
  it('renders the operator summary packet without object leakage', () => {
    const markup = renderToStaticMarkup(
      createElement('div', null, [
        createElement(WorkItemHeader, {
          key: 'header',
          workItem: createMilestone(),
          breadcrumbs: ['Release readiness', 'QA'],
          childCount: 2,
          linkedTaskCount: 3,
          artifactCount: 2,
          stages: createStages(),
          onSelectWorkItem: () => undefined,
        }),
        createElement(WorkItemFocusPacket, {
          key: 'focus',
          executionSummary: summarizeWorkItemExecution(createTasks()),
          artifactCount: 2,
          memoryCount: 4,
          eventCount: 6,
        }),
        createElement(MilestoneOperatorSummarySection, {
          key: 'milestone-summary',
          summary: {
            totalChildren: 2,
            completedChildren: 1,
            openChildren: 1,
            awaitingStepDecisions: 1,
            failedSteps: 0,
            inFlightSteps: 1,
            activeStageNames: ['qa'],
            activeColumnIds: ['active'],
          },
        }),
        createElement(MilestoneChildrenSection, {
          key: 'children',
          children: createMilestone().children ?? [],
          onSelectWorkItem: () => undefined,
        }),
        createElement(WorkItemReviewClosure, {
          key: 'closure',
          title: 'Summary complete',
          detail: 'Move into controls only when routing needs to change.',
        }),
      ]),
    );

    expect(markup).toContain('Operator breadcrumb');
    expect(markup).toContain('Release readiness');
    expect(markup).toContain('Stage progress');
    expect(markup).toContain('What needs attention next');
    expect(markup).toContain('Milestone group summary');
    expect(markup).toContain('Milestone children');
    expect(markup).toContain('Summary complete');
    expect(markup).not.toContain('[object Object]');
  });
});

function createMilestone(): DashboardGroupedWorkItemRecord {
  return {
    id: 'milestone-1',
    workflow_id: 'workflow-1',
    title: 'Release readiness',
    goal: 'Package the final QA review set.',
    column_id: 'active',
    priority: 'high',
    stage_name: 'qa',
    owner_role: 'qa_specialist',
    task_count: 3,
    is_milestone: true,
    children_count: 2,
    children_completed: 1,
    rework_count: 1,
    next_expected_actor: 'operator',
    next_expected_action: 'review follow-up',
    acceptance_criteria: 'All QA evidence is attached.',
    notes: 'Coordinate with release owner.',
    children: [
      {
        id: 'child-1',
        workflow_id: 'workflow-1',
        title: 'Collect release notes',
        column_id: 'active',
        priority: 'medium',
        stage_name: 'qa',
        completed_at: '2026-03-31T00:00:00.000Z',
      },
      {
        id: 'child-2',
        workflow_id: 'workflow-1',
        title: 'Confirm deployment timing',
        column_id: 'active',
        priority: 'medium',
        stage_name: 'qa',
      },
    ],
  } as DashboardGroupedWorkItemRecord;
}

function createStages(): DashboardWorkflowStageRecord[] {
  return [
    {
      id: 'stage-1',
      workflow_id: 'workflow-1',
      name: 'qa',
      position: 0,
      status: 'in_progress',
      gate_status: 'awaiting_approval',
      total_work_item_count: 4,
      open_work_item_count: 2,
      iteration_count: 2,
    } as DashboardWorkflowStageRecord,
  ];
}

function createTasks(): DashboardWorkItemTaskRecord[] {
  return [
    {
      id: 'task-1',
      title: 'Review evidence packet',
      state: 'awaiting_approval',
      role: 'qa_specialist',
      stage_name: 'qa',
      work_item_id: 'milestone-1',
      depends_on: [],
    },
    {
      id: 'task-2',
      title: 'Assemble rollout notes',
      state: 'in_progress',
      role: 'writer',
      stage_name: 'qa',
      work_item_id: 'milestone-1',
      depends_on: ['task-1'],
    },
  ] as DashboardWorkItemTaskRecord[];
}
