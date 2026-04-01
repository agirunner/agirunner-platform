import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowDeliverableRecord } from '../../../lib/api.js';
import {
  resolveBrowserDownloadHref,
  WorkflowDeliverableBrowser,
} from './workflow-deliverable-browser.js';

const hostOutputPath = resolve('release-audit');

describe('WorkflowDeliverableBrowser', () => {
  it('renders text artifact rows in a table with view and download actions', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
          preview_capabilities: {
            can_inline_preview: true,
            preview_kind: 'markdown',
          },
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
            path: 'artifacts/releases/final-package.json',
            artifact_id: 'artifact-1',
            size_bytes: 1536,
          } as never,
        }),
      }),
    );

    expect(html).toContain('<table');
    expect(html).toContain('Item');
    expect(html).toContain('Type');
    expect(html).toContain('Recorded');
    expect(html).toContain('Action');
    expect(html).toContain('final-package.json');
    expect(html).toContain('Artifact');
    expect(html).toContain('View');
    expect(html).toContain('Download');
    expect(html).not.toContain('Loading artifact preview');
    expect(html).not.toContain('Targets in this deliverable');
    expect(html).not.toContain('Open artifact in new tab');
  });

  it('renders inline summary deliverables as their own readable row without auto-opening them', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
          primary_target: {
            target_kind: 'inline_summary',
            label: 'Terminal brief',
            url: '',
          },
          content_preview: {
            summary:
              'The workflow is complete and the product brief is ready for operator review.',
          },
          summary_brief: 'The workflow is complete and the product brief is ready.',
        }),
      }),
    );

    expect(html).toContain('Terminal brief');
    expect(html).toContain('Inline summary');
    expect(html).toContain('View');
    expect(html).not.toContain(
      'The workflow is complete and the product brief is ready for operator review.',
    );
  });

  it('hides the view action for non-text artifact rows', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
          preview_capabilities: {
            can_inline_preview: false,
            preview_kind: 'binary',
          },
          primary_target: {
            target_kind: 'artifact',
            label: 'Open artifact',
            url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
            path: 'artifacts/releases/release-bundle.zip',
            artifact_id: 'artifact-1',
          } as never,
        }),
      }),
    );

    expect(html).toContain('release-bundle.zip');
    expect(html).toContain('Download');
    expect(html).not.toContain('View');
    expect(html).not.toContain('Hide');
  });

  it('supports artifact, repository, external url, workflow document, host directory, and inline content rows together', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
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
            {
              target_kind: 'external_url',
              label: 'Published brief',
              url: 'https://example.com/briefs/release-audit',
            },
            {
              target_kind: 'workflow_document',
              label: 'Workflow spec',
              url: '',
              path: 'docs/release-spec.md',
            },
            {
              target_kind: 'host_directory',
              label: 'Host output',
              url: '',
              path: hostOutputPath,
            },
            {
              target_kind: 'inline_summary',
              label: 'Completion notes',
              url: '',
            },
          ],
          content_preview: {
            summary: 'Release audit is complete and the evidence set is ready.',
          },
        }),
      }),
    );

    expect(html).toContain('release-bundle.zip');
    expect(html).toContain('Release repository');
    expect(html).toContain('Published brief');
    expect(html).toContain('Workflow spec');
    expect(html).toContain('Host output');
    expect(html).toContain('Completion notes');
    expect(html).toContain('Repository');
    expect(html).toContain('External URL');
    expect(html).toContain('Workflow document');
    expect(html).toContain('Host directory');
    expect(html).toContain('Inline summary');
  });

  it('renders canonical reference links inline without forcing a new tab', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
          primary_target: {
            target_kind: 'external_url',
            label: 'Published brief',
            url: 'https://example.com/briefs/release-audit',
          },
        }),
      }),
    );

    expect(html).toContain('Published brief');
    expect(html).toContain('View');
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('Canonical target');
  });

  it('renders path-only references as inline metadata instead of workspace recursion copy', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
          primary_target: {
            target_kind: 'workflow_document',
            label: 'Workflow spec',
            url: '',
            path: 'docs/release-spec.md',
          },
        }),
      }),
    );

    expect(html).toContain('Workflow spec');
    expect(html).toContain('Workflow document');
    expect(html).toContain('View');
    expect(html).not.toContain('Already visible in this workflow workspace.');
    expect(html).not.toContain('Open target');
  });

  it('keeps long artifact lists fully present instead of silently capping them', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
          primary_target: {
            target_kind: 'artifact',
            label: 'Artifact',
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
        }),
      }),
    );

    expect(html).toContain('evidence-01.txt');
    expect(html).toContain('evidence-21.txt');
    expect(html).not.toContain('evidence-22.txt');
  });

  it('rewrites deprecated artifact preview paths to canonical task download endpoints', () => {
    expect(
      resolveBrowserDownloadHref('http://localhost:3000/artifacts/tasks/task-1/artifact-1'),
    ).toBe('http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/download');
    expect(
      resolveBrowserDownloadHref('http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/preview'),
    ).toBe('http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/download');
  });

  it('renders invalid timestamps as a neutral dash instead of unknown time copy', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDeliverableBrowser, {
        deliverable: createDeliverable({
          created_at: 'not-a-date',
          updated_at: 'not-a-date',
        }),
      }),
    );

    expect(html).toContain('<td class="px-3 py-2 align-top text-muted-foreground">—</td>');
    expect(html).not.toContain('Unknown time');
  });
});

function createDeliverable(
  overrides: Partial<DashboardWorkflowDeliverableRecord> = {},
): DashboardWorkflowDeliverableRecord {
  return {
    descriptor_id: overrides.descriptor_id ?? 'deliverable-1',
    workflow_id: overrides.workflow_id ?? 'workflow-1',
    work_item_id: overrides.work_item_id ?? null,
    descriptor_kind: overrides.descriptor_kind ?? 'deliverable_packet',
    delivery_stage: overrides.delivery_stage ?? 'final',
    title: overrides.title ?? 'Release output set',
    state: overrides.state ?? 'final',
    summary_brief: overrides.summary_brief ?? 'Release output set is ready for review.',
    preview_capabilities: overrides.preview_capabilities ?? {},
    primary_target: overrides.primary_target ?? {
      target_kind: 'inline_summary',
      label: 'Inline summary',
      url: '',
    },
    secondary_targets: overrides.secondary_targets ?? [],
    content_preview: overrides.content_preview ?? {
      summary: 'Release output set is ready for review.',
    },
    source_brief_id: overrides.source_brief_id ?? null,
    created_at: overrides.created_at ?? '2026-03-30T10:00:00.000Z',
    updated_at: overrides.updated_at ?? overrides.created_at ?? '2026-03-30T10:00:00.000Z',
  };
}
