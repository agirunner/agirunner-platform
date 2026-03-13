import { buildWorkflowOperatorPermalink } from '../pages/work/task-operator-flow.js';

import { MAX_INLINE_ARTIFACT_PREVIEW_BYTES } from './artifact-preview-support.js';

export interface ArtifactPreviewOperatorNavigation {
  primaryHref: string;
  primaryLabel: string;
  primaryHelper: string;
  diagnosticHref: string | null;
  diagnosticLabel: string | null;
  sourceContextBody: string;
}

export interface ArtifactPreviewTaskContext {
  workflow?: { id: string } | null;
  work_item_id?: string | null;
  stage_name?: string | null;
  activation_id?: string | null;
}

export function formatArtifactPreviewFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getPreviewModeLabel(
  artifact: { size_bytes: number } | null,
  previewDescriptor: { canPreview: boolean } | null,
): string {
  if (!artifact || !previewDescriptor) {
    return 'Preview unavailable';
  }
  if (!previewDescriptor.canPreview) {
    return 'Download only';
  }
  if (artifact.size_bytes > MAX_INLINE_ARTIFACT_PREVIEW_BYTES) {
    return 'Download or raw source';
  }
  return 'Inline preview ready';
}

export function buildArtifactPreviewOperatorNavigation(input: {
  taskId: string;
  task: ArtifactPreviewTaskContext | null | undefined;
}): ArtifactPreviewOperatorNavigation {
  const workflowScope = {
    workflow_id: input.task?.workflow?.id ?? null,
    work_item_id: input.task?.work_item_id ?? null,
    stage_name: input.task?.stage_name ?? null,
    activation_id: input.task?.activation_id ?? null,
  };
  const operatorHref = buildWorkflowOperatorPermalink(workflowScope);

  if (workflowScope.workflow_id && workflowScope.work_item_id && operatorHref) {
    return {
      primaryHref: operatorHref,
      primaryLabel: 'Back to work-item flow',
      primaryHelper:
        'Return to the grouped work-item flow first so artifact review stays attached to board context and operator decisions.',
      diagnosticHref: `/work/tasks/${encodeURIComponent(input.taskId)}`,
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview stays tied to the grouped work-item flow that produced it, so operators can return there first and only open step diagnostics when they need lower-level runtime detail.',
    };
  }

  if (workflowScope.workflow_id && workflowScope.stage_name && operatorHref) {
    return {
      primaryHref: operatorHref,
      primaryLabel: 'Back to board stage flow',
      primaryHelper:
        'Return to the board stage flow first so review, rework, and escalation stay attached to the current stage.',
      diagnosticHref: `/work/tasks/${encodeURIComponent(input.taskId)}`,
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview stays tied to the current board stage flow, so operators can return there first and only open step diagnostics when they need lower-level runtime detail.',
    };
  }

  if (workflowScope.workflow_id) {
    return {
      primaryHref: `/work/workflows/${encodeURIComponent(workflowScope.workflow_id)}`,
      primaryLabel: 'Back to board context',
      primaryHelper:
        'Return to the board context first, then open step diagnostics only if you need lower-level runtime detail.',
      diagnosticHref: `/work/tasks/${encodeURIComponent(input.taskId)}`,
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview stays tied to the surrounding board context, so operators can return there first and only open step diagnostics when they need lower-level runtime detail.',
    };
  }

  return {
    primaryHref: `/work/tasks/${encodeURIComponent(input.taskId)}`,
    primaryLabel: 'Back to step record',
    primaryHelper: 'This artifact is only linked to the source step record, so continue review there.',
    diagnosticHref: null,
    diagnosticLabel: null,
    sourceContextBody:
      'This preview is only linked to the source step record, so continue review there unless a broader board context is added later.',
  };
}
