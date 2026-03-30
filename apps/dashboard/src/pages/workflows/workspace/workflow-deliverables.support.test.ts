import { describe, expect, it } from 'vitest';

import {
  hasMeaningfulDeliverableTarget,
  isInPlaceArtifactPreviewTarget,
  resolveDeliverableTargetAction,
  sanitizeDeliverableTarget,
} from './workflow-deliverables.support.js';

describe('workflow deliverables support', () => {
  it('rewrites deprecated task artifact routes to direct artifact links without deprecated return navigation', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'artifact',
        label: 'Open artifact',
        url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1?return_to=%2Fworkflows',
      }),
    ).toEqual({
      action_kind: 'external_link',
      href: 'http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/preview',
    });
  });

  it('strips deprecated return navigation params from direct artifact links while preserving other query params', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'artifact',
        label: 'Open artifact',
        url:
          'http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/preview?download=1&return_to=%2Fworkflows%2Fworkflow-1&return_source=workspace-artifacts',
      }),
    ).toEqual({
      action_kind: 'external_link',
      href: 'http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/preview?download=1',
    });
  });

  it('rewrites deprecated task artifact download routes to direct download links without stale workflow navigation params', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'artifact',
        label: 'Download artifact',
        url:
          'http://localhost:3000/artifacts/tasks/task-1/artifact-1/download?return_to=%2Fworkflows%2Fworkflow-1&return_source=workspace-artifacts',
      }),
    ).toEqual({
      action_kind: 'external_link',
      href: 'http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/download',
    });
  });

  it('keeps workflow file targets as direct links instead of classifying them for inline preview', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'input_packet_file',
        label: 'Open launch packet',
        url:
          'http://localhost:3000/api/v1/workflows/workflow-1/input-packets/packet-1/files/file-1/content?return_to=%2Fworkflows%2Fworkflow-1',
      }),
    ).toEqual({
      action_kind: 'external_link',
      href: 'http://localhost:3000/api/v1/workflows/workflow-1/input-packets/packet-1/files/file-1/content',
    });
  });

  it('keeps repository and external links as new-window links instead of forcing the preview dialog', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'repository',
        label: 'Open repository output',
        url: 'https://github.com/example/repo/pull/42',
      }),
    ).toEqual({
      action_kind: 'external_link',
      href: 'https://github.com/example/repo/pull/42',
    });
  });

  it('classifies deprecated workflow deliverable routes as inline references instead of actionable links', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'artifact',
        label: 'Release bundle',
        url: '/workflows/workflow-1/deliverables/deliverable-1',
      }),
    ).toEqual({
      action_kind: 'inline_reference',
    });
  });

  it('recognizes artifact preview paths regardless of origin style', () => {
    expect(isInPlaceArtifactPreviewTarget('/artifacts/tasks/task-1/artifact-1')).toBe(true);
    expect(
      isInPlaceArtifactPreviewTarget(
        'http://localhost:3000/artifacts/tasks/task-1/artifact-1?return_to=%2Fworkflows',
      ),
    ).toBe(true);
    expect(isInPlaceArtifactPreviewTarget('/api/v1/tasks/task-1/artifacts/artifact-1')).toBe(true);
    expect(
      isInPlaceArtifactPreviewTarget(
        '/api/v1/workflows/workflow-1/input-packets/packet-1/files/file-1/content',
      ),
    ).toBe(true);
    expect(isInPlaceArtifactPreviewTarget('https://example.invalid/repo/pull/42')).toBe(false);
  });

  it('normalizes malformed targets instead of throwing when target fields are missing', () => {
    const normalized = sanitizeDeliverableTarget({} as never);

    expect(normalized).toEqual({
      target_kind: '',
      label: '',
      url: '',
      path: null,
      repo_ref: null,
      artifact_id: null,
      size_bytes: null,
    });
    expect(hasMeaningfulDeliverableTarget(normalized)).toBe(false);
    expect(resolveDeliverableTargetAction(normalized)).toEqual({
      action_kind: 'inline_reference',
    });
  });
});
