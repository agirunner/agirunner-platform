import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkflowDeliverableBrowser } from './workflow-deliverable-browser.js';

describe('WorkflowDeliverableBrowser', () => {
  it('renders inline-only canonical targets for non-artifact deliverables', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-inline-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Workflow completion record',
          state: 'final',
          summary_brief: 'The canonical workflow target should still be shown inline.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'workflow',
            label: 'Workflow record',
            url: '/workflows/workflow-1?tab=details',
            path: 'records/workflow-completion.md',
          },
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-29T00:00:00.000Z',
          updated_at: '2026-03-29T00:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('Canonical deliverable targets');
    expect(html).toContain('Workflow record (Workflow)');
    expect(html).toContain('Already visible in this workflow workspace.');
    expect(html).toContain('records/workflow-completion.md');
  });

  it('uses the preview endpoint in the iframe while keeping artifact download on the browser action', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-artifact-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Release bundle',
          state: 'final',
          summary_brief: 'Artifact preview should stay inline.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Release bundle',
            url: 'http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/download',
            path: 'artifacts/release-bundle.zip',
            artifact_id: 'artifact-1',
          },
          secondary_targets: [],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-29T00:00:00.000Z',
          updated_at: '2026-03-29T00:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('Download artifact');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/download');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/preview');
    expect(html).not.toContain('src="http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/download"');
  });
});
