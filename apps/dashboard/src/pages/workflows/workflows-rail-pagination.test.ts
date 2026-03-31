import { describe, expect, it } from 'vitest';

import { combineWorkflowRailPages, getNextWorkflowRailPageParam } from './workflows-rail-pagination.js';

describe('workflows rail pagination helpers', () => {
  it('appends unique rows across pages without resetting the first page packet metadata', () => {
    const packet = combineWorkflowRailPages({
      pageParams: [1, 2],
      pages: [
        createPage({
          rows: [{ workflow_id: 'workflow-1', name: 'Workflow 1' }],
          ongoing_rows: [{ workflow_id: 'workflow-ongoing', name: 'Workflow Ongoing', lifecycle: 'ongoing' }],
          total_count: 4,
        }),
        createPage({
          rows: [
            { workflow_id: 'workflow-1', name: 'Workflow 1' },
            { workflow_id: 'workflow-2', name: 'Workflow 2' },
          ],
          ongoing_rows: [{ workflow_id: 'workflow-ongoing-2', name: 'Workflow Ongoing 2', lifecycle: 'ongoing' }],
          total_count: 4,
        }),
      ],
    });

    expect(packet).toBeTruthy();
    expect(packet?.rows.map((row) => row.workflow_id)).toEqual(['workflow-1', 'workflow-2']);
    expect(packet?.ongoing_rows.map((row) => row.workflow_id)).toEqual([
      'workflow-ongoing',
      'workflow-ongoing-2',
    ]);
    expect(packet?.visible_count).toBe(4);
    expect(packet?.total_count).toBe(4);
    expect(packet?.next_cursor).toBeNull();
  });

  it('requests the next page while the loaded page set is still below the reported total', () => {
    expect(
      getNextWorkflowRailPageParam(
        createPage({ rows: [{ workflow_id: 'workflow-2', name: 'Workflow 2' }], total_count: 3 }),
        [
          createPage({ rows: [{ workflow_id: 'workflow-1', name: 'Workflow 1' }], total_count: 3 }),
          createPage({ rows: [{ workflow_id: 'workflow-2', name: 'Workflow 2' }], total_count: 3 }),
        ],
      ),
    ).toBe(3);
  });

  it('uses unique loaded rows when deciding whether another page is needed', () => {
    expect(
      getNextWorkflowRailPageParam(
        createPage({
          rows: [{ workflow_id: 'workflow-2', name: 'Workflow 2' }],
          ongoing_rows: [{ workflow_id: 'workflow-ongoing', name: 'Workflow Ongoing', lifecycle: 'ongoing' }],
          total_count: 4,
        }),
        [
          createPage({
            rows: [{ workflow_id: 'workflow-1', name: 'Workflow 1' }],
            ongoing_rows: [{ workflow_id: 'workflow-ongoing', name: 'Workflow Ongoing', lifecycle: 'ongoing' }],
            total_count: 4,
          }),
          createPage({
            rows: [{ workflow_id: 'workflow-2', name: 'Workflow 2' }],
            ongoing_rows: [{ workflow_id: 'workflow-ongoing', name: 'Workflow Ongoing', lifecycle: 'ongoing' }],
            total_count: 4,
          }),
        ],
      ),
    ).toBe(3);
  });
});

function createPage(input: {
  rows?: Array<{ workflow_id: string; name: string; lifecycle?: string | null }>;
  ongoing_rows?: Array<{ workflow_id: string; name: string; lifecycle?: string | null }>;
  total_count?: number;
}) {
  return {
    generated_at: '2026-03-31T00:00:00.000Z',
    latest_event_id: 1,
    snapshot_version: 'workflow-operations:1',
    mode: 'live' as const,
    rows: (input.rows ?? []).map((row) => ({
      workflow_id: row.workflow_id,
      name: row.name,
      state: 'active',
      lifecycle: row.lifecycle ?? 'planned',
      current_stage: null,
      workspace_name: 'Workspace',
      playbook_name: 'Playbook',
      posture: 'progressing',
      live_summary: '',
      last_changed_at: '2026-03-31T00:00:00.000Z',
      needs_action: false,
      counts: {
        active_task_count: 0,
        active_work_item_count: 0,
        blocked_work_item_count: 0,
        open_escalation_count: 0,
        waiting_for_decision_count: 0,
        failed_task_count: 0,
      },
    })),
    ongoing_rows: (input.ongoing_rows ?? []).map((row) => ({
      workflow_id: row.workflow_id,
      name: row.name,
      state: 'active',
      lifecycle: row.lifecycle ?? 'ongoing',
      current_stage: null,
      workspace_name: 'Workspace',
      playbook_name: 'Playbook',
      posture: 'progressing',
      live_summary: '',
      last_changed_at: '2026-03-31T00:00:00.000Z',
      needs_action: false,
      counts: {
        active_task_count: 0,
        active_work_item_count: 0,
        blocked_work_item_count: 0,
        open_escalation_count: 0,
        waiting_for_decision_count: 0,
        failed_task_count: 0,
      },
    })),
    selected_workflow_id: null,
    visible_count: (input.rows?.length ?? 0) + (input.ongoing_rows?.length ?? 0),
    total_count: input.total_count ?? (input.rows?.length ?? 0) + (input.ongoing_rows?.length ?? 0),
    next_cursor: null,
  };
}
