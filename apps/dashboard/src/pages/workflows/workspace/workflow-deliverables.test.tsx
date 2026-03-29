import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardTaskRecord, DashboardWorkflowDeliverablesPacket } from '../../../lib/api.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';

describe('WorkflowDeliverables', () => {
  it('renders an in-page artifact browser instead of external open actions', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Produced artifacts (1)');
    expect(html).toContain('Download artifact');
    expect(html).toContain('<iframe');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/preview');
    expect(html).not.toContain('/artifacts/tasks/task-1/artifact-1');
    expect(html).not.toContain('Open artifact in new tab');
    expect(html).toContain('Deliverables');
  });

  it('keeps the inputs section flat and operator-readable', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Inputs');
    expect(html).not.toContain('Inputs &amp; Provenance');
    expect(html).not.toContain('<summary class="cursor-pointer text-xs');
    expect(html).not.toContain('rounded-xl border border-border/70 bg-muted/10 p-3');
    expect(html).not.toContain('Launch Packet');
    expect(html).not.toContain('Intake &amp; Plan Updates');
    expect(html).not.toContain('Intervention Attachments');
    expect(html).not.toContain('Redrive Packet');
  });

  it('opens briefs by default when there are no materialized deliverables yet', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createBriefOnlyPacket(),
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Workflow deliverables (0)');
    expect(html).toContain('Material output is currently available only as briefs for this layer.');
    expect(html).toContain('Brief-backed output');
    expect(html).toContain('No work item deliverables are available yet.');
    expect(html).not.toContain('Briefs (1)');
  });

  it('keeps rolled-up work-item finals visible in workflow scope alongside workflow-scoped packets', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [
            {
              descriptor_id: 'deliverable-work-item-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'deliverable_packet',
              delivery_stage: 'final',
              title: 'workflow-intake-01 completion packet',
              state: 'final',
              summary_brief: 'Final work item packet.',
              preview_capabilities: {},
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Review completion packet',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Final work item packet.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T21:00:00.000Z',
              updated_at: '2026-03-28T21:00:00.000Z',
            },
          ],
          in_progress_deliverables: [
            {
              descriptor_id: 'deliverable-workflow-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              descriptor_kind: 'brief_packet',
              delivery_stage: 'in_progress',
              title: 'Workflow summary packet',
              state: 'under_review',
              summary_brief: 'Workflow review is still in progress.',
              preview_capabilities: {},
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Review workflow packet',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Workflow review is still in progress.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T20:55:00.000Z',
              updated_at: '2026-03-28T20:55:00.000Z',
            },
          ],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
        },
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Work item deliverables (1)');
    expect(html).toContain('workflow-intake-01 completion packet');
    expect(html).toContain('Workflow deliverables (1)');
    expect(html).toContain('Workflow summary packet');
  });

  it('separates workflow and work-item deliverables in workflow scope so rolled-up child packets do not masquerade as workflow output', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createTaskScopePacket(),
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Workflow deliverables (0)');
    expect(html).toContain('Work item deliverables (1)');
    expect(html).toContain('No workflow deliverables are available yet.');
    expect(html).toContain('Release bundle');
    expect(html).not.toContain('Final deliverables (1)');
  });

  it('keeps task scope anchored on task evidence and clearly labels the parent work-item deliverables', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createTaskScopePacket(),
        selectedTask: createTask(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Generate release bundle',
          banner: 'Task: Generate release bundle',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Task output and evidence');
    expect(html).toContain('Generate release bundle');
    expect(html).toContain('Showing parent work item deliverables from Prepare release bundle.');
    expect(html).toContain('Workflow deliverables stay visible below the parent work item.');
    expect(html).toContain('artifact-1');
    expect(html).toContain('Parent work item deliverables (1)');
    expect(html).toContain('Deliverables promoted from Prepare release bundle stay here.');
    expect(html).toContain('Workflow deliverables (0)');
    expect(html).toContain('Workflow-wide deliverables stay visible below the parent work item.');
    expect(html).toContain('No workflow deliverables are available yet.');
    expect(html).toContain('No inputs or intervention files are attached to this work item.');
    expect(html).not.toContain('Final deliverables (1)');
    expect(html).not.toContain('In-progress deliverables (0)');
    expect(html).not.toContain('No inputs or intervention files are attached to this selected work item.');
  });

  it('uses the exact selected work-item title when task scope falls back to parent deliverables', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: createTask(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Generate release bundle',
          banner: 'Task: Generate release bundle',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Showing parent work item deliverables from Prepare release bundle.');
    expect(html).not.toContain('Showing parent work item deliverables from Generate release bundle.');
  });

  it('separates task evidence, parent work-item deliverables, and workflow deliverables in task scope', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createMixedScopePacket(),
        selectedTask: createTask(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Generate release bundle',
          banner: 'Task: Generate release bundle',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Task output and evidence');
    expect(html).toContain('Parent work item deliverables (1)');
    expect(html).toContain('Workflow deliverables (1)');
    expect(html).toContain('Release checklist');
    expect(html).toContain('Program status brief');
    expect(html).not.toContain('Final deliverables (2)');
    expect(html).not.toContain('Workflow deliverables stay available in workflow scope.');
  });

  it('keeps task scope ordered even when a deliverable is backed by a brief', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createTaskScopePacketWithWorkItemBrief(),
        selectedTask: createTask(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Generate release bundle',
          banner: 'Task: Generate release bundle',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).not.toContain('Outcome Brief');
    expect(html.indexOf('Task output and evidence')).toBeLessThan(html.indexOf('Parent work item deliverables (1)'));
    expect(html.indexOf('Parent work item deliverables (1)')).toBeLessThan(html.indexOf('Workflow deliverables (0)'));
    expect(html).toContain('Release bundle');
    expect(html).toContain('Release bundle brief');
  });

  it('reclassifies final packets out of the in-progress bucket for selected task scope', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [],
          in_progress_deliverables: [
            {
              descriptor_id: 'deliverable-draft',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'deliverable_packet',
              delivery_stage: 'in_progress',
              title: 'Draft packet',
              state: 'draft',
              summary_brief: 'Still in progress.',
              preview_capabilities: {},
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Review packet',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Still in progress.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T20:55:00.000Z',
              updated_at: '2026-03-28T20:55:00.000Z',
            },
            {
              descriptor_id: 'deliverable-final',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'deliverable_packet',
              delivery_stage: 'final',
              title: 'Final packet',
              state: 'final',
              summary_brief: 'Operator-ready.',
              preview_capabilities: {},
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Review packet',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Operator-ready.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T21:00:00.000Z',
              updated_at: '2026-03-28T21:00:00.000Z',
            },
          ],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
        },
        selectedTask: createTask(),
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'Prepare release bundle',
        scope: {
          scopeKind: 'selected_task',
          title: 'Task',
          subject: 'task',
          name: 'Generate release bundle',
          banner: 'Task: Generate release bundle',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Parent work item deliverables (2)');
    expect(html.indexOf('Final packet')).toBeLessThan(html.indexOf('Draft packet'));
  });

  it('renders synthesized inline-summary deliverables without deprecated navigation links', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [
            {
              descriptor_id: 'handoff:1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              descriptor_kind: 'handoff_packet',
              delivery_stage: 'final',
              title: 'workflow-intake-01 completion packet',
              state: 'final',
              summary_brief: 'workflow-intake-01 is approved and ready to remain open.',
              preview_capabilities: { can_inline_preview: true, preview_kind: 'structured_summary' },
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Review completion packet',
                url: '',
              },
              secondary_targets: [],
              content_preview: {
                summary:
                  'workflow-intake-01 is approved and ready to remain open.\n\nApproved the intake packet and confirmed it satisfies the readiness criteria.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T20:20:00.000Z',
              updated_at: '2026-03-28T20:20:00.000Z',
            },
          ],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
        },
        scope: {
          scopeKind: 'selected_work_item',
          title: 'Work item',
          subject: 'work item',
          name: 'workflow-intake-01',
          banner: 'Work item: workflow-intake-01',
        },
        selectedTask: null,
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'workflow-intake-01',
        onLoadMore: () => undefined,
      }),
    );

    expect(html).toContain('workflow-intake-01 completion packet');
    expect(html).toContain('Approved the intake packet and confirmed it satisfies the readiness criteria.');
    expect(html).toContain('Approved the intake packet and confirmed it satisfies the readiness criteria.');
    expect(html).not.toContain('Open artifact in new tab');
  });

  it('renders malformed deliverable targets without crashing the tab', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [
            {
              descriptor_id: 'deliverable-malformed',
              workflow_id: 'workflow-1',
              work_item_id: null,
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Workflow summary packet',
              state: 'final',
              summary_brief: 'A malformed target should not take down the tab.',
              preview_capabilities: {},
              primary_target: {} as never,
              secondary_targets: [{} as never],
              content_preview: {
                summary: 'The summary still renders even when target payloads are malformed.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T20:20:00.000Z',
              updated_at: '2026-03-28T20:20:00.000Z',
            },
          ],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
        },
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        onLoadMore: () => undefined,
      }),
    );

    expect(html).toContain('Workflow summary packet');
    expect(html).toContain('The summary still renders even when target payloads are malformed.');
    expect(html).not.toContain('Open artifact in new tab');
  });

  it('keeps deprecated workflow deliverable targets inline so the deliverables tab does not send operators to removed surfaces', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [
            {
              descriptor_id: 'deliverable-inline-only',
              workflow_id: 'workflow-1',
              work_item_id: null,
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Release bundle',
              state: 'final',
              summary_brief: 'The release bundle is already rendered in this surface.',
              preview_capabilities: {},
              primary_target: {
                target_kind: 'artifact',
                label: 'Release bundle',
                url: '/workflows/workflow-1/deliverables/deliverable-inline-only',
                path: 'artifacts/release-bundle.zip',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Operators should stay on the deliverables tab for this packet.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T20:20:00.000Z',
              updated_at: '2026-03-28T20:20:00.000Z',
            },
          ],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
        },
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        onLoadMore: () => undefined,
      }),
    );

    expect(html).toContain('Release bundle');
    expect(html).toContain('Operators should stay on the deliverables tab for this packet.');
    expect(html).not.toContain('Produced artifacts');
    expect(html).not.toContain('href="/workflows/workflow-1/deliverables/deliverable-inline-only"');
    expect(html).not.toContain('Open artifact in new tab');
  });

  it('shows every artifact target inside the deliverables browser without truncating the list', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [
            {
              ...createPacket().final_deliverables[0],
              secondary_targets: Array.from({ length: 24 }, (_, index) => ({
                target_kind: 'artifact',
                label: `Artifact ${index + 2}`,
                url: `http://localhost:3000/artifacts/tasks/task-1/artifact-${index + 2}`,
                path: `artifacts/release-bundle-${index + 2}.zip`,
                artifact_id: `artifact-${index + 2}`,
              })),
            },
          ],
          in_progress_deliverables: [],
          working_handoffs: [],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
        },
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Produced artifacts (25)');
    expect(html).toContain('Artifact 25');
    expect(html).not.toContain('Produced artifacts (20)');
  });

  it('keeps work-item scope on brief-backed outputs when no materialized deliverables exist for the selected work item', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [
            {
              descriptor_id: 'deliverable-1',
              workflow_id: 'workflow-1',
              work_item_id: null,
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Workflow release brief',
              state: 'final',
              summary_brief: 'Workflow summary ready.',
              preview_capabilities: {},
              primary_target: {
                target_kind: 'inline_summary',
                label: 'Review summary',
                url: '/workflows/workflow-1/deliverables/deliverable-1',
              },
              secondary_targets: [],
              content_preview: {
                summary: 'Workflow summary ready.',
              },
              source_brief_id: null,
              created_at: '2026-03-28T08:00:00.000Z',
              updated_at: '2026-03-28T08:00:00.000Z',
            },
          ],
          in_progress_deliverables: [],
          working_handoffs: [
            {
              id: 'brief-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-1',
              task_id: 'task-1',
              request_id: 'request-1',
              execution_context_id: 'task-1',
              brief_kind: 'milestone',
              brief_scope: 'deliverable_context',
              source_kind: 'specialist',
              source_role_name: 'Policy Assessor',
              status_kind: 'approved',
              short_brief: {
                headline: 'workflow-intake-01 is approved and ready to remain open.',
              },
              detailed_brief_json: {
                headline: 'workflow-intake-01 is approved and ready to remain open.',
                summary: 'Only the finalized brief exists for this work item.',
                status_kind: 'approved',
              },
              linked_target_ids: [],
              sequence_number: 1,
              related_artifact_ids: [],
              related_output_descriptor_ids: [],
              related_intervention_ids: [],
              canonical_workflow_brief_id: null,
              created_by_type: 'agent',
              created_by_id: 'agent-1',
              created_at: '2026-03-28T08:10:00.000Z',
              updated_at: '2026-03-28T08:10:00.000Z',
            },
          ],
          inputs_and_provenance: {
            launch_packet: null,
            supplemental_packets: [],
            intervention_attachments: [],
            redrive_packet: null,
          },
          next_cursor: null,
        },
        selectedTask: null,
        selectedWorkItemId: 'work-item-1',
        selectedWorkItemTitle: 'workflow-intake-01',
        scope: {
          scopeKind: 'selected_work_item',
          title: 'Work item',
          subject: 'work item',
          name: 'workflow-intake-01',
          banner: 'Work item: workflow-intake-01',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Work item deliverables (0)');
    expect(html).toContain('Material output is currently available only as briefs for this layer.');
    expect(html).toContain('workflow-intake-01 is approved and ready to remain open.');
    expect(html).toContain('Workflow deliverables (1)');
    expect(html).toContain('Workflow release brief');
  });

  it('keeps rolled-up work-item deliverables visible in workflow scope', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          ...createMixedScopePacket(),
        },
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Program status brief');
    expect(html).toContain('Release checklist');
    expect(html).toContain('Workflow deliverables (1)');
    expect(html).toContain('Work item deliverables (1)');
  });

  it('tolerates incomplete deliverables packets and malformed records without crashing', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(WorkflowDeliverables, {
          packet: {
            final_deliverables: [
              {
                descriptor_id: 'deliverable-incomplete',
                workflow_id: 'workflow-1',
                work_item_id: null,
                title: 'Recovered deliverable',
                content_preview: {
                  summary: 'The dashboard should still render this partial record.',
                },
              },
            ],
            inputs_and_provenance: null,
          } as unknown as DashboardWorkflowDeliverablesPacket,
          selectedTask: null,
          selectedWorkItemId: null,
          selectedWorkItemTitle: null,
          scope: {
            scopeKind: 'workflow',
            title: 'Workflow',
            subject: 'workflow',
            name: 'Workflow 1',
            banner: 'Workflow: Workflow 1',
          },
          onLoadMore: vi.fn(),
        }),
      ),
    ).not.toThrow();

    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: {
          final_deliverables: [
            {
              descriptor_id: 'deliverable-incomplete',
              workflow_id: 'workflow-1',
              work_item_id: null,
              title: 'Recovered deliverable',
              content_preview: {
                summary: 'The dashboard should still render this partial record.',
              },
            },
          ],
          inputs_and_provenance: null,
        } as unknown as DashboardWorkflowDeliverablesPacket,
        selectedTask: null,
        selectedWorkItemId: null,
        selectedWorkItemTitle: null,
        scope: {
          scopeKind: 'workflow',
          title: 'Workflow',
          subject: 'workflow',
          name: 'Workflow 1',
          banner: 'Workflow: Workflow 1',
        },
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Recovered deliverable');
    expect(html).toContain('The dashboard should still render this partial record.');
    expect(html).toContain('No inputs or intervention files are attached to this workflow.');
    expect(html).toContain('Workflow deliverables (1)');
  });
});

function createPacket(): DashboardWorkflowDeliverablesPacket {
  return {
    final_deliverables: [
      {
        descriptor_id: 'deliverable-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Release bundle',
        state: 'final',
        summary_brief: 'The release bundle is ready for operator review.',
        preview_capabilities: {},
        primary_target: {
          target_kind: 'artifact',
          label: 'Open artifact',
          url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
          path: 'artifacts/release-bundle.zip',
          artifact_id: 'artifact-1',
        },
        secondary_targets: [],
        content_preview: {
          summary: 'Release notes and bundle metadata are available.',
        },
        source_brief_id: null,
        created_at: '2026-03-27T06:00:00.000Z',
        updated_at: '2026-03-27T06:00:00.000Z',
      },
    ],
    in_progress_deliverables: [],
    working_handoffs: [],
    inputs_and_provenance: {
      launch_packet: null,
      supplemental_packets: [],
      intervention_attachments: [],
      redrive_packet: null,
    },
    next_cursor: null,
  };
}

function createBriefOnlyPacket(): DashboardWorkflowDeliverablesPacket {
  return {
    final_deliverables: [],
    in_progress_deliverables: [],
    working_handoffs: [
      {
        id: 'brief-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
        task_id: null,
        request_id: 'request-1',
        execution_context_id: 'activation-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'orchestrator',
        source_role_name: 'Orchestrator',
        status_kind: 'completed',
        short_brief: {
          headline: 'Workflow review packet is complete',
        },
        detailed_brief_json: {
          headline: 'Workflow review packet is complete',
          status_kind: 'completed',
          summary: 'The orchestrator published a completed workflow brief but no formal deliverable descriptor yet exists.',
        },
        linked_target_ids: [],
        sequence_number: 1,
        related_artifact_ids: [],
        related_output_descriptor_ids: [],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'agent',
        created_by_id: 'agent-1',
        created_at: '2026-03-28T08:00:00.000Z',
        updated_at: '2026-03-28T08:00:00.000Z',
      },
    ],
    inputs_and_provenance: {
      launch_packet: null,
      supplemental_packets: [],
      intervention_attachments: [],
      redrive_packet: null,
    },
    next_cursor: null,
  };
}

function createTask(): DashboardTaskRecord {
  return {
    id: 'task-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    workspace_id: 'workspace-1',
    parent_id: null,
    title: 'Generate release bundle',
    description: null,
    state: 'completed',
    priority: 'high',
    execution_backend: 'runtime_plus_task',
    used_task_sandbox: true,
    role: 'builder',
    role_config: {},
    environment: {},
    resource_bindings: [],
    input: {},
    output: {
      artifact_id: 'artifact-1',
      path: 'artifacts/release-bundle.zip',
      summary: 'Generated the release archive for operator review.',
    },
    metadata: {},
    assigned_agent_id: null,
    assigned_worker_id: null,
    depends_on: [],
    timeout_minutes: 30,
    auto_retry: false,
    max_retries: 0,
    retry_count: 0,
    claimed_at: null,
    started_at: '2026-03-27T06:00:00.000Z',
    completed_at: '2026-03-27T06:10:00.000Z',
    failed_at: null,
    cancelled_at: null,
    created_at: '2026-03-27T05:55:00.000Z',
    updated_at: '2026-03-27T06:10:00.000Z',
    workflow: {
      id: 'workflow-1',
      name: 'Workflow 1',
      workspace_id: 'workspace-1',
    },
    workflow_name: 'Workflow 1',
    workspace_name: 'Workspace',
    work_item_id: 'work-item-1',
    work_item_title: 'Prepare release bundle',
    stage_name: 'release',
    activation_id: 'activation-1',
    execution_environment: null,
  };
}

function createTaskScopePacket(): DashboardWorkflowDeliverablesPacket {
  return {
    final_deliverables: [
      {
        descriptor_id: 'deliverable-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Release bundle',
        state: 'final',
        summary_brief: 'The release bundle is ready for operator review.',
        preview_capabilities: {},
        primary_target: {
          target_kind: 'artifact',
          label: 'Open artifact',
          url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
          path: 'artifacts/release-bundle.zip',
          artifact_id: 'artifact-1',
        },
        secondary_targets: [],
        content_preview: {
          summary: 'Release notes and bundle metadata are available.',
        },
        source_brief_id: null,
        created_at: '2026-03-27T06:00:00.000Z',
        updated_at: '2026-03-27T06:00:00.000Z',
      },
    ],
    in_progress_deliverables: [],
    working_handoffs: [],
    inputs_and_provenance: {
      launch_packet: null,
      supplemental_packets: [],
      intervention_attachments: [],
      redrive_packet: null,
    },
    next_cursor: null,
  };
}

function createMixedScopePacket(): DashboardWorkflowDeliverablesPacket {
  return {
    final_deliverables: [
      {
        descriptor_id: 'deliverable-work-item',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Release checklist',
        state: 'final',
        summary_brief: 'The work item checklist is ready.',
        preview_capabilities: {},
        primary_target: {
          target_kind: 'artifact',
          label: 'Open artifact',
          url: 'http://localhost:3000/artifacts/tasks/task-1/checklist-1',
          path: 'artifacts/release-checklist.md',
          artifact_id: 'artifact-checklist-1',
        },
        secondary_targets: [],
        content_preview: {
          summary: 'Checklist summary',
        },
        source_brief_id: null,
        created_at: '2026-03-27T06:00:00.000Z',
        updated_at: '2026-03-27T06:00:00.000Z',
      },
      {
        descriptor_id: 'deliverable-workflow',
        workflow_id: 'workflow-1',
        work_item_id: null,
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Program status brief',
        state: 'final',
        summary_brief: 'Workflow-wide operator status summary.',
        preview_capabilities: {},
        primary_target: {
          target_kind: 'artifact',
          label: 'Open artifact',
          url: 'http://localhost:3000/artifacts/tasks/task-2/status-1',
          path: 'artifacts/status-brief.md',
          artifact_id: 'artifact-status-1',
        },
        secondary_targets: [],
        content_preview: {
          summary: 'Workflow summary',
        },
        source_brief_id: null,
        created_at: '2026-03-27T06:05:00.000Z',
        updated_at: '2026-03-27T06:05:00.000Z',
      },
    ],
    in_progress_deliverables: [],
    working_handoffs: [],
    inputs_and_provenance: {
      launch_packet: null,
      supplemental_packets: [],
      intervention_attachments: [],
      redrive_packet: null,
    },
    next_cursor: null,
  };
}

function createTaskScopePacketWithWorkItemBrief(): DashboardWorkflowDeliverablesPacket {
  return {
    final_deliverables: [
      {
        descriptor_id: 'deliverable-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        descriptor_kind: 'artifact',
        delivery_stage: 'final',
        title: 'Release bundle',
        state: 'final',
        summary_brief: 'The release bundle is ready for operator review.',
        preview_capabilities: {},
        primary_target: {
          target_kind: 'artifact',
          label: 'Open artifact',
          url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
          path: 'artifacts/release-bundle.zip',
          artifact_id: 'artifact-1',
        },
        secondary_targets: [],
        content_preview: {
          summary: 'Release notes and bundle metadata are available.',
        },
        source_brief_id: 'brief-1',
        created_at: '2026-03-27T06:00:00.000Z',
        updated_at: '2026-03-27T06:00:00.000Z',
      },
    ],
    in_progress_deliverables: [],
    working_handoffs: [
      {
        id: 'brief-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
        request_id: 'request-1',
        execution_context_id: 'task-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'specialist',
        source_role_name: 'Reviewer',
        status_kind: 'completed',
        short_brief: {
          headline: 'Release bundle brief',
        },
        detailed_brief_json: {
          headline: 'Release bundle brief',
          summary: 'The reviewer confirmed the release bundle details inline.',
          sections: {
            deliverables: ['Release bundle is ready for operator review.'],
          },
        },
        linked_target_ids: [],
        sequence_number: 1,
        related_artifact_ids: [],
        related_output_descriptor_ids: [],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'agent',
        created_by_id: 'agent-1',
        created_at: '2026-03-28T08:00:00.000Z',
        updated_at: '2026-03-28T08:00:00.000Z',
      },
    ],
    inputs_and_provenance: {
      launch_packet: null,
      supplemental_packets: [],
      intervention_attachments: [],
      redrive_packet: null,
    },
    next_cursor: null,
  };
}
