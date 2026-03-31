import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowRailRow } from '../../lib/api.js';
import { WorkflowsRail } from './workflows-rail.js';

describe('WorkflowsRail lifecycle filters', () => {
  it('renders a unified lifecycle toggle instead of a separate ongoing preview section', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsRail as never, {
        mode: 'live',
        search: '',
        needsActionOnly: false,
        lifecycleFilter: 'all',
        playbookId: null,
        updatedWithin: 'all',
        rows: [createRailRow({ workflow_id: 'workflow-planned', name: 'Planned workflow' })],
        ongoingRows: [
          createRailRow({
            workflow_id: 'workflow-ongoing',
            name: 'Ongoing workflow',
            lifecycle: 'ongoing',
          }),
        ],
        playbooks: [],
        selectedWorkflowId: 'workflow-ongoing',
        selectedWorkflowRow: null,
        hasNextPage: false,
        isLoading: false,
        onModeChange: vi.fn(),
        onLifecycleFilterChange: vi.fn(),
        onPlaybookFilterChange: vi.fn(),
        onSearchChange: vi.fn(),
        onNeedsActionOnlyChange: vi.fn(),
        onUpdatedWithinChange: vi.fn(),
        onSelectWorkflow: vi.fn(),
        onLoadMore: vi.fn(),
        onCreateWorkflow: vi.fn(),
      }),
    );

    expect(html).toContain('All');
    expect(html).toContain('Ongoing');
    expect(html).toContain('Planned');
    expect(html).not.toContain('Show all');
    expect(html).not.toContain('<p class="text-sm font-semibold text-foreground">Ongoing</p>');
    expect(html).toContain('Ongoing workflow');
    expect(html).toContain('Planned workflow');
  });
});

function createRailRow(
  overrides: Partial<DashboardWorkflowRailRow> & Pick<DashboardWorkflowRailRow, 'workflow_id' | 'name'>,
): DashboardWorkflowRailRow {
  const { workflow_id, name, ...rest } = overrides;
  return {
    workflow_id,
    name,
    state: 'active',
    lifecycle: 'planned',
    current_stage: null,
    workspace_name: 'Workspace',
    playbook_name: 'Playbook',
    posture: 'progressing',
    live_summary: 'Working through the current lane.',
    last_changed_at: new Date().toISOString(),
    needs_action: false,
    counts: {
      active_task_count: 1,
      active_work_item_count: 1,
      blocked_work_item_count: 0,
      open_escalation_count: 0,
      waiting_for_decision_count: 0,
      failed_task_count: 0,
    },
    ...rest,
  };
}
