import type { ArtifactPreviewReturnSource } from '../lib/artifact-navigation.js';
import { buildWorkflowOperatorPermalink } from '../pages/work-shared/task-operator-flow.js';

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
  workspace_id?: string | null;
}

export interface ArtifactPreviewReturnContext {
  returnTo: string | null;
  returnSource: ArtifactPreviewReturnSource | null;
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
  returnContext?: ArtifactPreviewReturnContext;
}): ArtifactPreviewOperatorNavigation {
  const contextualNavigation = buildContextualArtifactNavigation(
    input.taskId,
    input.returnContext,
  );
  if (contextualNavigation) {
    return contextualNavigation;
  }
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
      primaryHref: `/work/boards/${encodeURIComponent(workflowScope.workflow_id)}`,
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

function buildContextualArtifactNavigation(
  taskId: string,
  returnContext: ArtifactPreviewReturnContext | undefined,
): ArtifactPreviewOperatorNavigation | null {
  if (!returnContext?.returnTo || !returnContext.returnSource) {
    return null;
  }

  if (returnContext.returnSource === 'workspace-artifacts') {
    return {
      primaryHref: returnContext.returnTo,
      primaryLabel: 'Back to workspace artifacts',
      primaryHelper:
        'Return to the workspace artifact explorer so the selected workflow scope, filters, and artifact packet stay intact.',
      diagnosticHref: `/work/tasks/${encodeURIComponent(taskId)}`,
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview was opened from the workspace artifact explorer, so return there first to keep workspace-level browsing, provenance checks, and adjacent artifact review intact.',
    };
  }

  if (returnContext.returnSource === 'workspace-content') {
    return {
      primaryHref: returnContext.returnTo,
      primaryLabel: 'Back to workspace content',
      primaryHelper:
        'Return to the workspace content surface so artifact review stays attached to the current workflow and task packet.',
      diagnosticHref: `/work/tasks/${encodeURIComponent(taskId)}`,
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview was opened from the workspace content surface, so return there first to continue document and artifact management in one place.',
    };
  }

  if (returnContext.returnSource === 'workflow-board') {
    return {
      primaryHref: returnContext.returnTo,
      primaryLabel: 'Back to board context',
      primaryHelper:
        'Return to the board first so artifact review stays attached to the surrounding stage and work-item flow.',
      diagnosticHref: `/work/tasks/${encodeURIComponent(taskId)}`,
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview was opened from the board surface, so return there first and only open lower-level diagnostics when needed.',
    };
  }

  if (returnContext.returnSource === 'workflow-inspector') {
    return {
      primaryHref: returnContext.returnTo,
      primaryLabel: 'Back to board inspector',
      primaryHelper:
        'Return to the inspector so the artifact stays attached to the current activation trace and board diagnostics.',
      diagnosticHref: `/work/tasks/${encodeURIComponent(taskId)}`,
      diagnosticLabel: 'Open step diagnostics',
      sourceContextBody:
        'This preview was opened from the inspector, so return there first to continue trace review alongside the raw execution context.',
    };
  }

  return {
    primaryHref: returnContext.returnTo,
    primaryLabel: 'Back to step record',
    primaryHelper:
      'Return to the source step record so artifact review stays attached to the producing execution packet.',
    diagnosticHref: `/work/tasks/${encodeURIComponent(taskId)}`,
    diagnosticLabel: 'Open step diagnostics',
    sourceContextBody:
      'This preview was opened from the source step record, so return there first unless you need a broader board or workspace surface.',
  };
}
