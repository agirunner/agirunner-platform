import { describe, expect, it } from 'vitest';

import {
  isInPlaceArtifactPreviewTarget,
  resolveDeliverableTargetAction,
} from './workflow-deliverables.support.js';

describe('workflow deliverables support', () => {
  it('rewrites deprecated task artifact routes to direct artifact content preview targets', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'artifact',
        label: 'Open artifact',
        url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1?return_to=%2Fworkflows',
      }),
    ).toEqual({
      action_kind: 'dialog_preview',
      href: 'http://localhost:3000/api/v1/tasks/task-1/artifacts/artifact-1/content?return_to=%2Fworkflows',
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
});
