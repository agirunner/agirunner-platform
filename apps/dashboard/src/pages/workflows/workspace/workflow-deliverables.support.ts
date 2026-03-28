import type { DashboardWorkflowDeliverableTarget } from '../../../lib/api.js';

export interface DeliverableTargetAction {
  action_kind: 'dialog_preview' | 'external_link';
  href: string;
}

const ARTIFACT_PREVIEW_PATH_PATTERN = /^\/artifacts\/tasks\/[^/]+\/[^/]+$/;

export function resolveDeliverableTargetAction(
  target: DashboardWorkflowDeliverableTarget,
): DeliverableTargetAction {
  if (isInPlaceArtifactPreviewTarget(target.url)) {
    return {
      action_kind: 'dialog_preview',
      href: target.url,
    };
  }

  return {
    action_kind: 'external_link',
    href: target.url,
  };
}

export function isInPlaceArtifactPreviewTarget(url: string): boolean {
  const normalizedPath = readNormalizedPath(url);
  return normalizedPath !== null && ARTIFACT_PREVIEW_PATH_PATTERN.test(normalizedPath);
}

function readNormalizedPath(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, 'http://dashboard.local');
    return parsed.pathname;
  } catch {
    return null;
  }
}
