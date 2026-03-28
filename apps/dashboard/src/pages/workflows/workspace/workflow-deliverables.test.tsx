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
