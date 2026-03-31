import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardWorkspaceTimelineEntry } from '../../lib/api.js';
import { WorkspaceTimelineCard } from './workflow-detail-workspace-timeline-card.js';

describe('workflow detail workspace timeline card', () => {
  it('renders continuity metrics and linked workflow cards', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(WorkspaceTimelineCard, {
          isLoading: false,
          hasError: false,
          currentWorkflowId: 'workflow-1',
          entries: [createEntry(), createChildEntry()],
        }),
      ),
    );

    expect(markup).toContain('Workspace Timeline');
    expect(markup).toContain('Run continuity');
    expect(markup).toContain('Release candidate');
    expect(markup).toContain('Current board');
    expect(markup).toContain('Best next step:');
    expect(markup).toContain('Open inspector');
    expect(markup).toContain('Permalink');
  });
});

function createEntry(): DashboardWorkspaceTimelineEntry {
  return {
    workflow_id: 'workflow-1',
    name: 'Release candidate',
    state: 'active',
    created_at: '2026-03-12T20:30:00Z',
    completed_at: null,
    stage_progression: [{ status: 'completed' }, { status: 'running' }],
    stage_metrics: [{ work_item_counts: { total: 5, open: 2 }, gate_status: 'awaiting_approval' }],
    orchestrator_analytics: { activation_count: 4, total_cost_usd: 5.25 },
    produced_artifacts: [{ id: 'artifact-1' }],
    workflow_relations: {
      parent: null,
      children: [],
      latest_child_workflow_id: 'workflow-2',
      child_status_counts: {
        total: 1,
        active: 1,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
    },
  };
}

function createChildEntry(): DashboardWorkspaceTimelineEntry {
  return {
    workflow_id: 'workflow-2',
    name: 'Follow-up rollout',
    state: 'completed',
    created_at: '2026-03-12T19:30:00Z',
    completed_at: '2026-03-12T21:00:00Z',
    stage_metrics: [],
    orchestrator_analytics: { activation_count: 1, total_cost_usd: 1.25 },
    produced_artifacts: [],
    workflow_relations: {
      parent: null,
      children: [],
      latest_child_workflow_id: null,
      child_status_counts: {
        total: 0,
        active: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
    },
  };
}
