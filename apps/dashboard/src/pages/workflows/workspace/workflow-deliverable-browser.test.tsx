import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkflowDeliverableBrowser } from './workflow-deliverable-browser.js';

describe('WorkflowDeliverableBrowser', () => {
  it('treats artifact-looking targets as browser artifacts even when the stored target kind is inline summary', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-artifact-inline-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Release package',
          state: 'final',
          summary_brief: 'The canonical release package should stay previewable here.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Release package',
            url: 'http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/download',
            path: 'artifacts/releases/release-package.json',
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

    expect(html).toContain('Targets in this deliverable (1)');
    expect(html).toContain('Download file');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/preview');
    expect(html).not.toContain('Other deliverable targets');
  });

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

    expect(html).toContain('Targets in this deliverable (1)');
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

    expect(html).toContain('Download file');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/download');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/preview');
    expect(html).not.toContain(
      'src="http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/download"',
    );
  });

  it('uses artifact file names for selector labels when stored labels are navigation verbs', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-artifact-labels-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Release evidence packet',
          state: 'final',
          summary_brief: 'Artifact tabs should identify the actual files.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
            path: 'artifacts/releases/final-package.json',
            artifact_id: 'artifact-1',
          },
          secondary_targets: [
            {
              target_kind: 'artifact',
              label: 'Artifact',
              url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-2',
              path: 'artifacts/releases/release-summary.md',
              artifact_id: 'artifact-2',
            },
          ],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-29T00:00:00.000Z',
          updated_at: '2026-03-29T00:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('final-package.json');
    expect(html).toContain('release-summary.md');
    expect(html).not.toContain('>Open artifact<');
    expect(html).not.toContain('>Artifact<');
  });

  it('shows one unified target chooser when a deliverable mixes artifact and repository targets', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-mixed-targets-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Release output set',
          state: 'final',
          summary_brief: 'Artifacts and repository references should stay in one browser.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
            path: 'artifacts/releases/release-bundle.zip',
            artifact_id: 'artifact-1',
          },
          secondary_targets: [
            {
              target_kind: 'repo_reference',
              label: 'Release repository',
              url: 'https://github.com/example/release-audit/pull/42',
              repo_ref: 'github.com/example/release-audit/pull/42',
            },
          ],
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-29T00:00:00.000Z',
          updated_at: '2026-03-29T00:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('Targets in this deliverable (2)');
    expect(html).toContain('release-bundle.zip');
    expect(html).toContain('>Release repository<');
    expect(html).not.toContain('Files in this deliverable (1)');
    expect(html).not.toContain('Other deliverable targets');
  });
});
