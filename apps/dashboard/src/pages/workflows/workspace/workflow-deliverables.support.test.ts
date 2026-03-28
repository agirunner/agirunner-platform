import { describe, expect, it } from 'vitest';

import {
  isInPlaceArtifactPreviewTarget,
  resolveDeliverableTargetAction,
} from './workflow-deliverables.support.js';

describe('workflow deliverables support', () => {
  it('routes task artifact preview permalinks through the in-place preview dialog flow', () => {
    expect(
      resolveDeliverableTargetAction({
        target_kind: 'artifact',
        label: 'Open artifact',
        url: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
      }),
    ).toEqual({
      action_kind: 'dialog_preview',
      href: 'http://localhost:3000/artifacts/tasks/task-1/artifact-1',
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
    expect(isInPlaceArtifactPreviewTarget('https://example.invalid/repo/pull/42')).toBe(false);
  });
});
