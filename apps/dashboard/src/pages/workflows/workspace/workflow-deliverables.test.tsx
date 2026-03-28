import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWorkflowDeliverablesPacket } from '../../../lib/api.js';
import { WorkflowDeliverables } from './workflow-deliverables.js';

describe('WorkflowDeliverables', () => {
  it('offers in-place artifact preview actions without routing the operator away from Workflows', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createPacket(),
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
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Inputs');
    expect(html).not.toContain('Inputs &amp; Provenance');
    expect(html).not.toContain('<summary class="cursor-pointer text-xs');
    expect(html).not.toContain('rounded-xl border border-border/70 bg-muted/10 p-3');
  });

  it('opens briefs by default when there are no materialized deliverables yet', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverables, {
        packet: createBriefOnlyPacket(),
        onLoadMore: vi.fn(),
      }),
    );

    expect(html).toContain('Briefs (1)');
    expect(html).toContain('<details class="rounded-2xl border border-border/70 bg-background/80 p-4" open="">');
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
