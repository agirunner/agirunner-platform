import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowWorkspacePacket } from '../../../lib/api.js';
import {
  createPacket,
  renderWorkbench,
} from './workflow-bottom-workbench.test-support.js';

describe('WorkflowBottomWorkbench deliverables', () => {
  it('renders the deliverables tab even when the scoped deliverables packet is incomplete', () => {
    const packet = createPacket();

    expect(() =>
      renderWorkbench({
        packet: {
          ...packet,
          bottom_tabs: {
            ...packet.bottom_tabs,
            counts: {
              ...packet.bottom_tabs.counts,
              deliverables: 1,
            },
          },
          deliverables: {
            final_deliverables: [
              {
                descriptor_id: 'deliverable-incomplete',
                workflow_id: 'workflow-1',
                work_item_id: null,
                title: 'Recovered deliverable',
                content_preview: {
                  summary:
                    'Deliverables tab should render instead of tripping the workspace fallback.',
                },
              },
            ],
            inputs_and_provenance: null,
          } as unknown as DashboardWorkflowWorkspacePacket['deliverables'],
        },
        activeTab: 'deliverables',
      }),
    ).not.toThrow();

    const html = renderWorkbench({
      packet: {
        ...packet,
        bottom_tabs: {
          ...packet.bottom_tabs,
          counts: {
            ...packet.bottom_tabs.counts,
            deliverables: 1,
          },
        },
        deliverables: {
          final_deliverables: [
            {
              descriptor_id: 'deliverable-incomplete',
              workflow_id: 'workflow-1',
              work_item_id: null,
              title: 'Recovered deliverable',
              content_preview: {
                summary:
                  'Deliverables tab should render instead of tripping the workspace fallback.',
              },
            },
          ],
          inputs_and_provenance: null,
        } as unknown as DashboardWorkflowWorkspacePacket['deliverables'],
      },
      activeTab: 'deliverables',
    });

    expect(html).toContain('Deliverables');
    expect(html).toContain('Recovered deliverable');
  });

  it('keeps deliverables aligned with the normalized work-item scope when outer props are stale', () => {
    const packet = createPacket();
    const html = renderWorkbench({
      board: {
        columns: packet.board?.columns ?? [],
        work_items: [
          {
            id: 'work-item-7',
            workflow_id: 'workflow-1',
            stage_name: 'release',
            title: 'Prepare release bundle',
            goal: 'Assemble final artifacts for launch.',
            column_id: 'in_progress',
            priority: 'normal',
          },
        ],
        active_stages: packet.board?.active_stages ?? [],
        awaiting_gate_count: packet.board?.awaiting_gate_count ?? 0,
        stage_summary: packet.board?.stage_summary ?? [],
      },
      packet: {
        ...packet,
        selected_scope: {
          scope_kind: 'selected_task',
          work_item_id: 'work-item-7',
          task_id: 'task-3',
        },
        bottom_tabs: {
          ...packet.bottom_tabs,
          current_scope_kind: 'selected_task',
          current_work_item_id: 'work-item-7',
          current_task_id: 'task-3',
        },
        deliverables: {
          ...packet.deliverables,
          final_deliverables: [
            {
              descriptor_id: 'deliverable-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-7',
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Release checklist',
              state: 'final',
              summary_brief: 'Operator-ready release checklist.',
              preview_capabilities: {},
              primary_target: {
                target_kind: 'artifact',
                label: 'Open artifact in new tab',
                url: '/api/v1/tasks/task-3/artifacts/artifact-1/preview',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Checklist is ready for the operator.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T03:00:00.000Z',
              updated_at: '2026-03-28T03:00:00.000Z',
            },
          ],
        },
      },
      activeTab: 'deliverables',
      selectedWorkItemTasks: [
        {
          id: 'task-3',
          title: 'Verify deliverable',
          role: 'reviewer',
          state: 'in_progress',
          work_item_id: 'work-item-7',
          work_item_title: 'Prepare release bundle',
          output: {
            summary: 'Task evidence should stay visible while task details refetch.',
          },
        },
      ],
    });

    expect(html).toContain('Showing only deliverables recorded for Prepare release bundle.');
    expect(html).toContain('Release checklist');
    expect(html).not.toContain('Task output and evidence');
    expect(html).not.toContain('Showing all deliverables recorded across this workflow');
  });

  it('renders inline-content deliverables when task-scoped packets normalize to work-item deliverables', () => {
    const packet = createPacket();
    const html = renderWorkbench({
      board: {
        columns: packet.board?.columns ?? [],
        work_items: [
          {
            id: 'work-item-7',
            workflow_id: 'workflow-1',
            stage_name: 'release',
            title: 'Prepare release bundle',
            goal: 'Assemble final artifacts for launch.',
            column_id: 'in_progress',
            priority: 'normal',
          },
        ],
        active_stages: packet.board?.active_stages ?? [],
        awaiting_gate_count: packet.board?.awaiting_gate_count ?? 0,
        stage_summary: packet.board?.stage_summary ?? [],
      },
      packet: {
        ...packet,
        selected_scope: {
          scope_kind: 'selected_task',
          work_item_id: 'work-item-7',
          task_id: 'task-3',
        },
        bottom_tabs: {
          ...packet.bottom_tabs,
          current_scope_kind: 'selected_task',
          current_work_item_id: 'work-item-7',
          current_task_id: 'task-3',
        },
        deliverables: {
          ...packet.deliverables,
          final_deliverables: [
            {
              descriptor_id: 'deliverable-embedded-text',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-7',
              descriptor_kind: 'inline_summary',
              delivery_stage: 'final',
              title: 'Release analysis',
              state: 'final',
              summary_brief: null,
              preview_capabilities: {},
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Release analysis',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                text: 'Embedded release analysis without a target URL.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T03:00:00.000Z',
              updated_at: '2026-03-28T03:00:00.000Z',
            },
          ],
        },
      },
      activeTab: 'deliverables',
      selectedWorkItemTasks: [
        {
          id: 'task-3',
          title: 'Verify deliverable',
          role: 'reviewer',
          state: 'in_progress',
          work_item_id: 'work-item-7',
          work_item_title: 'Prepare release bundle',
          output: {
            summary: 'Task evidence should stay visible while task details refetch.',
          },
        },
      ],
    });

    expect(html).toContain('Release analysis');
    expect(html).toContain('Showing only deliverables recorded for Prepare release bundle.');
    expect(html).not.toContain('Open artifact in new tab');
  });

  it('does not revive a standalone history tab even when briefs and history packets are both populated', () => {
    const packet = {
      ...createPacket(),
      bottom_tabs: {
        ...createPacket().bottom_tabs,
        counts: {
          ...createPacket().bottom_tabs.counts,
          briefs: 1,
          history: 9,
        },
      },
      history: {
        ...createPacket().history,
        items: [
          {
            item_id: 'history-1',
            item_kind: 'platform_notice',
            source_kind: 'platform',
            source_label: 'Platform',
            headline: 'History packet only',
            summary: 'This row should not render on the Briefs tab.',
            created_at: '2026-03-28T03:00:00.000Z',
            work_item_id: null,
            task_id: null,
            linked_target_ids: ['workflow-1'],
          },
        ],
        groups: [
          {
            group_id: '2026-03-28',
            label: '2026-03-28',
            anchor_at: '2026-03-28T00:00:00.000Z',
            item_ids: ['history-1'],
          },
        ],
        total_count: 9,
      },
      briefs: {
        generated_at: '2026-03-28T03:00:00.000Z',
        latest_event_id: 10,
        snapshot_version: 'workflow-operations:10',
        items: [
          {
            brief_id: 'brief-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            task_id: null,
            request_id: 'brief-request-1',
            execution_context_id: 'execution-1',
            brief_kind: 'milestone',
            brief_scope: 'workflow_timeline',
            source_kind: 'orchestrator',
            source_label: 'Orchestrator',
            source_role_name: 'Orchestrator',
            headline: 'Brief packet headline',
            summary: 'This brief should render on the Briefs tab.',
            llm_turn_count: null,
            status_kind: 'handoff',
            short_brief: { headline: 'Brief packet headline' },
            detailed_brief_json: { summary: 'This brief should render on the Briefs tab.' },
            linked_target_ids: ['workflow-1'],
            sequence_number: 1,
            related_artifact_ids: [],
            related_output_descriptor_ids: [],
            related_intervention_ids: [],
            canonical_workflow_brief_id: null,
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-28T03:00:00.000Z',
            updated_at: '2026-03-28T03:00:00.000Z',
          },
        ],
        total_count: 1,
        next_cursor: null,
      },
    } as DashboardWorkflowWorkspacePacket & {
      briefs: {
        generated_at: string;
        latest_event_id: number;
        snapshot_version: string;
        items: Array<Record<string, unknown>>;
        total_count: number;
        next_cursor: string | null;
      };
    };
    const html = renderWorkbench({
      packet,
      activeTab: 'live_console',
    });

    expect(html).not.toContain('>History<');
    expect(html).not.toContain('Load more history');
    expect(html).not.toContain('History packet only');
  });
});
