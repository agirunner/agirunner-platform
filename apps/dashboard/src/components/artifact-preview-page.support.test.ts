import { describe, expect, it } from 'vitest';

import {
  type ArtifactPreviewTaskContext,
  buildArtifactPreviewOperatorNavigation,
  formatArtifactPreviewFileSize,
  getPreviewModeLabel,
} from './artifact-preview-page.support.js';

describe('artifact preview page support', () => {
  it('prefers the grouped work-item flow and demotes step detail to diagnostics', () => {
    expect(
      buildArtifactPreviewOperatorNavigation({
        taskId: 'task-1',
        task: {
          workflow: { id: 'workflow-1' },
          work_item_id: 'work-item-1',
          activation_id: 'activation-1',
        },
      }),
    ).toEqual({
      primaryHref:
        '/work/boards/workflow-1?work_item=work-item-1&activation=activation-1#work-item-work-item-1',
      primaryLabel: 'Back to work-item flow',
      primaryHelper:
        'Return to the grouped work-item flow first so artifact review stays attached to board context and operator decisions.',
      diagnosticHref: '/work/tasks/task-1',
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview stays tied to the grouped work-item flow that produced it, so operators can return there first and only open step diagnostics when they need lower-level runtime detail.',
    });
  });

  it('falls back to the board stage flow, board context, or direct step record as needed', () => {
    expect(
      buildArtifactPreviewOperatorNavigation({
        taskId: 'task-2',
        task: {
          workflow: { id: 'workflow-1' },
          stage_name: 'review',
        },
      }),
    ).toEqual({
      primaryHref: '/work/boards/workflow-1?gate=review#gate-review',
      primaryLabel: 'Back to board stage flow',
      primaryHelper:
        'Return to the board stage flow first so review, rework, and escalation stay attached to the current stage.',
      diagnosticHref: '/work/tasks/task-2',
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview stays tied to the current board stage flow, so operators can return there first and only open step diagnostics when they need lower-level runtime detail.',
    });

    expect(
      buildArtifactPreviewOperatorNavigation({
        taskId: 'task-3',
        task: {
          workflow: { id: 'workflow-1' },
        },
      }),
    ).toEqual({
      primaryHref: '/work/boards/workflow-1',
      primaryLabel: 'Back to board context',
      primaryHelper:
        'Return to the board context first, then open step diagnostics only if you need lower-level runtime detail.',
      diagnosticHref: '/work/tasks/task-3',
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview stays tied to the surrounding board context, so operators can return there first and only open step diagnostics when they need lower-level runtime detail.',
    });

    expect(
      buildArtifactPreviewOperatorNavigation({
        taskId: 'task-4',
        task: null,
      }),
    ).toEqual({
      primaryHref: '/work/tasks/task-4',
      primaryLabel: 'Back to step record',
      primaryHelper: 'This artifact is only linked to the source step record, so continue review there.',
      diagnosticHref: null,
      diagnosticLabel: null,
      sourceContextBody:
        'This preview is only linked to the source step record, so continue review there unless a broader board context is added later.',
    });
  });

  it('formats file sizes and preview mode labels for operator-facing copy', () => {
    expect(formatArtifactPreviewFileSize(512)).toBe('512 B');
    expect(formatArtifactPreviewFileSize(2048)).toBe('2.0 KB');
    expect(getPreviewModeLabel({ size_bytes: 1024 }, { canPreview: true })).toBe(
      'Inline preview ready',
    );
    expect(
      getPreviewModeLabel({ size_bytes: 900_000 }, { canPreview: true }),
    ).toBe('Download or raw source');
    expect(getPreviewModeLabel({ size_bytes: 128 }, { canPreview: false })).toBe(
      'Download only',
    );
  });
});
