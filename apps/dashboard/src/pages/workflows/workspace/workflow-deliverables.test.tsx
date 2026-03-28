import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardTaskRecord, DashboardWorkflowDeliverablesPacket } from '../../../lib/api.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';

describe('WorkflowDeliverables', () => {
  it('offers inline artifact preview actions without workflow-navigation copy or deprecated routes', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: null,
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

    expect(html).toContain('Preview inline');
    expect(html).toContain('Open artifact in new tab');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/content');
    expect(html).not.toContain('/artifacts/tasks/task-1/artifact-1');
    expect(html).not.toContain('Open without leaving workflow');
    expect(html).not.toContain('Open in new window');
    expect(html).toContain('Deliverables');
  });

  it('keeps the inputs section flat and operator-readable', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: null,
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

    expect(html).toContain('Brief-backed outputs');
    expect(html).toContain('Material output is currently available only as briefs for this workflow.');
    expect(html).toContain('No final deliverables are available yet.');
    expect(html).not.toContain('Briefs (1)');
  });

  it('keeps task scope anchored on task evidence and clearly labels the parent work-item deliverables', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createTaskScopePacket(),
        selectedTask: createTask(),
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
    expect(html).toContain('Showing work item deliverables from Prepare release bundle.');
    expect(html).toContain('Workflow deliverables stay available in workflow scope.');
    expect(html).toContain('artifact-1');
    expect(html).toContain('Final deliverables (1)');
    expect(html).toContain('In-progress deliverables (0)');
    expect(html).toContain('No in-progress deliverables are attached to this work item.');
    expect(html).toContain('No inputs or intervention files are attached to this work item.');
    expect(html).not.toContain('Parent Work Item Final Deliverables');
    expect(html).not.toContain('Parent Work Item In Progress Deliverables');
    expect(html).not.toContain('No in-progress deliverables are attached to this selected work item.');
    expect(html).not.toContain('No inputs or intervention files are attached to this selected work item.');
  });

  it('uses the exact selected work-item title when task scope falls back to parent deliverables', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: createTask(),
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

    expect(html).toContain('Showing work item deliverables from Prepare release bundle.');
    expect(html).not.toContain('Showing work item deliverables from Generate release bundle.');
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
        selectedWorkItemTitle: 'workflow-intake-01',
        onLoadMore: () => undefined,
      }),
    );

    expect(html).toContain('workflow-intake-01 completion packet');
    expect(html).toContain('Approved the intake packet and confirmed it satisfies the readiness criteria.');
    expect(html).not.toContain('Open artifact in new tab');
    expect(html).not.toContain('Preview inline');
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
          headline: 'Review packet is complete',
        },
        detailed_brief_json: {
          headline: 'Review packet is complete',
          status_kind: 'completed',
          summary: 'The reviewer published a completed brief but no formal deliverable descriptor yet exists.',
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
