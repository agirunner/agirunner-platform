import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardTaskRecord, DashboardWorkflowDeliverablesPacket } from '../../../lib/api.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';

describe('WorkflowDeliverables', () => {
  it('offers in-place artifact preview actions without routing the operator away from Workflows', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: null,
        selectedWorkItemTitle: null,
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Preview artifact in place');
    expect(html).toContain('Open in new window');
    expect(html).toContain('Deliverables');
  });

  it('keeps the inputs section flat and operator-readable', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: null,
        selectedWorkItemTitle: null,
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
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Brief-backed outputs (1)');
    expect(html).toContain('Material output is currently available only as workflow briefs.');
    expect(html).toContain('No final deliverables are available yet.');
    expect(html).not.toContain('Briefs (1)');
  });

  it('shows task evidence above parent deliverables when a task is selected', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
        selectedTask: createTask(),
        selectedWorkItemTitle: 'Prepare release bundle',
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Task Output / Evidence');
    expect(html).toContain('Generate release bundle');
    expect(html).toContain('Parent work item: Prepare release bundle');
    expect(html).toContain('Parent Work Item Deliverables');
    expect(html).toContain('Workflow Deliverables');
    expect(html).toContain('artifact-1');
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
