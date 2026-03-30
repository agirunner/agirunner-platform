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

  it('keeps workflow file targets previewable inline without a deprecated route jump', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-workflow-file-1',
          workflow_id: 'workflow-1',
          work_item_id: null,
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Launch packet file',
          state: 'final',
          summary_brief: 'Workflow file targets should stay previewable in place.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'input_packet_file',
            label: 'Launch packet',
            url: 'http://localhost:3000/api/v1/workflows/workflow-1/input-packets/packet-1/files/file-1/content',
            path: 'inputs/launch-summary.pdf',
            artifact_id: 'file-1',
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
    expect(html).toContain('<iframe');
    expect(html).toContain('/api/v1/workflows/workflow-1/input-packets/packet-1/files/file-1/content');
    expect(html).not.toContain('Preview is unavailable for this file.');
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

  it('prefers the first artifact preview when inline summary is only metadata for the same deliverable', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-inline-artifact-mixed-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Release packet',
          state: 'final',
          summary_brief: 'Release packet is ready for review.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Review completion packet',
            url: '',
          },
          secondary_targets: [
            {
              target_kind: 'artifact',
              label: 'Open artifact',
              url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
              path: 'artifacts/releases/final-package.json',
              artifact_id: 'artifact-1',
            },
            {
              target_kind: 'artifact',
              label: 'Artifact',
              url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-2',
              path: 'artifacts/releases/release-summary.md',
              artifact_id: 'artifact-2',
            },
          ],
          content_preview: {
            summary: 'Release packet is ready for review.',
          },
          source_brief_id: null,
          created_at: '2026-03-29T00:00:00.000Z',
          updated_at: '2026-03-29T00:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('Targets in this deliverable (2)');
    expect(html).toContain('final-package.json');
    expect(html).toContain('release-summary.md');
    expect(html).toContain('/api/v1/tasks/task-1/artifacts/artifact-1/preview');
    expect(html).not.toContain('Review completion packet (Inline Summary)');
  });

  it('does not silently cap long artifact target lists in the in-tab browser', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: {
          descriptor_id: 'deliverable-many-targets-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          descriptor_kind: 'deliverable_packet',
          delivery_stage: 'final',
          title: 'Release evidence set',
          state: 'final',
          summary_brief: 'Every artifact should stay selectable from this browser.',
          preview_capabilities: {},
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
            path: 'artifacts/releases/evidence-01.txt',
            artifact_id: 'artifact-1',
          },
          secondary_targets: Array.from({ length: 20 }, (_, index) => ({
            target_kind: 'artifact',
            label: 'Artifact',
            url: `http://localhost:3000/artifacts/tasks/task-1/artifact-${index + 2}`,
            path: `artifacts/releases/evidence-${String(index + 2).padStart(2, '0')}.txt`,
            artifact_id: `artifact-${index + 2}`,
          })),
          content_preview: {},
          source_brief_id: null,
          created_at: '2026-03-29T00:00:00.000Z',
          updated_at: '2026-03-29T00:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('Targets in this deliverable (21)');
    expect(html).toContain('evidence-01.txt');
    expect(html).toContain('evidence-21.txt');
    expect(html).not.toContain('Targets in this deliverable (20)');
  });
});
